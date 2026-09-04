/**
 * The GLSL subset's semantic checker: symbol tables, expression typing,
 * l-value legality, the loop-bound rule, and const evaluation. It annotates
 * the AST (via WeakMaps on the returned record, never by mutating nodes) so
 * the emitter can generate code without re-deriving a single type.
 *
 * The checker is also where the subset's *semantic* exclusions live — the
 * ones a parser cannot see: sampler values escaping texture() calls, arrays
 * anywhere but uniforms, `discard` outside a fragment main, recursion,
 * unbounded loops. Each refusal names the construct and, where one exists,
 * the inside-subset alternative, because the info log is the only voice this
 * compiler has.
 */

import {
  BOOL,
  CompileError,
  FLOAT,
  INT,
  componentCount,
  mat,
  sameType,
  typeName,
  vec,
} from "./ast";
import type {
  ArrayType,
  BlockStmt,
  Call,
  Expr,
  ForStmt,
  FunctionDecl,
  GlobalDecl,
  MatrixType,
  ScalarType,
  ShaderAst,
  Stmt,
  Type,
  VectorType,
} from "./ast";
import { EXCLUDED_FUNCTIONS, convertible, resolveBuiltin } from "./builtins";
import { parse } from "./parse";

export type Stage = "vertex" | "fragment";

/** One in/out/uniform declaration, resolved: arrays folded into the type. */
export interface GlobalInfo {
  readonly name: string;
  readonly type: Type;
  readonly layoutLocation: number | null;
  readonly line: number;
}

/** A checked shader: the AST plus everything the linker and emitter need. */
export interface CheckedShader {
  readonly stage: Stage;
  readonly ast: ShaderAst;
  /** Vertex attributes or fragment varyings, in declaration order. */
  readonly ins: readonly GlobalInfo[];
  /** Vertex varyings or the single fragment color output. */
  readonly outs: readonly GlobalInfo[];
  readonly uniforms: readonly GlobalInfo[];
  /** Const globals with their evaluated component values, for inlining. */
  readonly consts: ReadonlyMap<
    string,
    { readonly type: Type; readonly values: readonly number[] }
  >;
  readonly functions: ReadonlyMap<string, FunctionDecl>;
  /** Expression type annotations; every checked Expr has an entry. */
  readonly types: WeakMap<Expr, Type>;
  /** Constant-int annotations for expressions that fold, used for index emission. */
  readonly constInts: WeakMap<Expr, number>;
}

/* ------------------------------------------------------------------------ */
/* Symbols and scopes                                                       */
/* ------------------------------------------------------------------------ */

interface VarSymbol {
  readonly type: Type;
  readonly assignable: boolean;
  /** Where the value lives; the emitter maps these to storages the same way. */
  readonly space: "in" | "out" | "uniform" | "const" | "local" | "builtin";
  readonly constValues: readonly number[] | null;
}

class Scopes {
  private readonly stack: Map<string, VarSymbol>[] = [new Map()];

  push(): void {
    this.stack.push(new Map());
  }

  pop(): void {
    this.stack.pop();
  }

  declare(name: string, symbol: VarSymbol, line: number): void {
    const top = this.stack[this.stack.length - 1];
    if (top === undefined)
      throw new Error("headless-webgl2: internal: empty scope stack");
    if (top.has(name))
      throw new CompileError(
        line,
        `'${name}' is already declared in this scope`,
      );
    top.set(name, symbol);
  }

  lookup(name: string): VarSymbol | null {
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      const found = this.stack[i]?.get(name);
      if (found !== undefined) return found;
    }
    return null;
  }
}

/* ------------------------------------------------------------------------ */
/* The checker                                                              */
/* ------------------------------------------------------------------------ */

const VERTEX_BUILTINS = new Map<string, VarSymbol>([
  [
    "gl_Position",
    {
      type: vec("float", 4),
      assignable: true,
      space: "builtin",
      constValues: null,
    },
  ],
  [
    "gl_PointSize",
    { type: FLOAT, assignable: true, space: "builtin", constValues: null },
  ],
]);

const FRAGMENT_BUILTINS = new Map<string, VarSymbol>([
  [
    "gl_FragCoord",
    {
      type: vec("float", 4),
      assignable: false,
      space: "builtin",
      constValues: null,
    },
  ],
  [
    "gl_FrontFacing",
    { type: BOOL, assignable: false, space: "builtin", constValues: null },
  ],
]);

class Checker {
  readonly stage: Stage;
  readonly scopes = new Scopes();
  readonly ins: GlobalInfo[] = [];
  readonly outs: GlobalInfo[] = [];
  readonly uniforms: GlobalInfo[] = [];
  readonly consts = new Map<
    string,
    { type: Type; values: readonly number[] }
  >();
  readonly functions = new Map<string, FunctionDecl>();
  readonly types = new WeakMap<Expr, Type>();
  readonly constInts = new WeakMap<Expr, number>();

  /** The function whose body is being checked; refuses recursion and types `return`. */
  private currentFunction: FunctionDecl | null = null;
  /** Loop counters in scope are locked against assignment, the termination guarantee. */
  private readonly lockedCounters = new Set<string>();

  constructor(stage: Stage) {
    this.stage = stage;
  }

  check(ast: ShaderAst): void {
    for (const global of ast.globals) this.checkGlobal(global);
    for (const fn of ast.functions) this.checkFunction(fn);

    const main = this.functions.get("main");
    if (main === undefined) {
      throw new CompileError(
        1,
        `the ${this.stage} shader has no 'void main()'`,
      );
    }
    if (main.returnType.kind !== "void" || main.params.length > 0) {
      throw new CompileError(
        main.line,
        "main must be declared 'void main()' with no parameters",
      );
    }
    if (this.stage === "fragment" && this.outs.length === 0) {
      throw new CompileError(
        1,
        "the fragment shader must declare exactly one 'out vec4' color output",
      );
    }
  }

  /* ---- globals ------------------------------------------------------- */

  private checkGlobal(decl: GlobalDecl): void {
    if (decl.type.kind === "void") {
      throw new CompileError(
        decl.line,
        `'${decl.name}' cannot be declared void`,
      );
    }

    // Arrays: uniforms only — the one place the engines need them (light
    // arrays, skinning palettes), and the one place flat f64 storage makes
    // dynamic indexing trivial.
    let type: Type = decl.type;
    if (decl.arraySize !== null) {
      if (decl.qualifier !== "uniform") {
        throw new CompileError(
          decl.line,
          `the array '${decl.name}' is outside the subset here; only uniform declarations may be arrays`,
        );
      }
      if (decl.type.kind === "sampler2D") {
        throw new CompileError(
          decl.line,
          "sampler arrays are outside the subset; declare individual sampler2D uniforms",
        );
      }
      const length = this.evalConstInt(decl.arraySize);
      if (length === null || length <= 0 || !Number.isInteger(length)) {
        throw new CompileError(
          decl.line,
          `the array size of '${decl.name}' must be a constant positive integer`,
        );
      }
      type = {
        kind: "array",
        element: decl.type as ArrayType["element"],
        length,
      };
    }

    const info: GlobalInfo = {
      name: decl.name,
      type,
      layoutLocation: decl.layoutLocation,
      line: decl.line,
    };

    switch (decl.qualifier) {
      case "const": {
        if (decl.init === null) {
          throw new CompileError(
            decl.line,
            `the const '${decl.name}' needs an initializer`,
          );
        }
        const initType = this.checkExpr(decl.init);
        if (!convertible(initType, type)) {
          throw new CompileError(
            decl.line,
            `cannot initialize const ${typeName(type)} '${decl.name}' from ${typeName(initType)}`,
          );
        }
        const values = this.evalConst(decl.init, type);
        if (values === null) {
          throw new CompileError(
            decl.line,
            `the initializer of const '${decl.name}' must be a constant expression`,
          );
        }
        this.consts.set(decl.name, { type, values });
        this.scopes.declare(
          decl.name,
          { type, assignable: false, space: "const", constValues: values },
          decl.line,
        );
        return;
      }
      case "uniform": {
        if (decl.init !== null) {
          throw new CompileError(
            decl.line,
            `the uniform '${decl.name}' cannot have an initializer; set it with the uniform* API`,
          );
        }
        this.uniforms.push(info);
        this.scopes.declare(
          decl.name,
          { type, assignable: false, space: "uniform", constValues: null },
          decl.line,
        );
        return;
      }
      case "in": {
        if (decl.init !== null)
          throw new CompileError(
            decl.line,
            `the input '${decl.name}' cannot have an initializer`,
          );
        if (this.stage === "vertex") this.checkAttributeType(type, decl);
        else this.checkVaryingType(type, decl);
        this.ins.push(info);
        this.scopes.declare(
          decl.name,
          { type, assignable: false, space: "in", constValues: null },
          decl.line,
        );
        return;
      }
      case "out": {
        if (decl.init !== null)
          throw new CompileError(
            decl.line,
            `the output '${decl.name}' cannot have an initializer`,
          );
        if (this.stage === "vertex") {
          this.checkVaryingType(type, decl);
        } else {
          // The single render target: exactly one out, and it is a vec4.
          if (this.outs.length > 0) {
            throw new CompileError(
              decl.line,
              "a second fragment output is outside the subset (multiple render targets); the fragment shader declares exactly one 'out vec4'",
            );
          }
          if (
            !(
              type.kind === "vector" &&
              type.scalar === "float" &&
              type.size === 4
            )
          ) {
            throw new CompileError(
              decl.line,
              `the fragment output '${decl.name}' must be vec4, got ${typeName(type)}`,
            );
          }
        }
        this.outs.push(info);
        this.scopes.declare(
          decl.name,
          { type, assignable: true, space: "out", constValues: null },
          decl.line,
        );
        return;
      }
    }
  }

  /** Vertex attributes: float scalars and vectors, the shapes `vertexAttribPointer` can feed. */
  private checkAttributeType(type: Type, decl: GlobalDecl): void {
    const ok =
      (type.kind === "scalar" && type.scalar === "float") ||
      (type.kind === "vector" && type.scalar === "float");
    if (!ok) {
      throw new CompileError(
        decl.line,
        `the vertex input '${decl.name}' must be a float scalar or vector, got ${typeName(type)} (integer and matrix attributes are outside the subset)`,
      );
    }
    if (
      decl.layoutLocation !== null &&
      (decl.layoutLocation < 0 || decl.layoutLocation > 15)
    ) {
      throw new CompileError(
        decl.line,
        `layout(location = ${decl.layoutLocation}) on '${decl.name}' is out of range; locations run 0..15`,
      );
    }
  }

  /** Varyings: float-based only, because everything interpolates smoothly (flat is outside the subset). */
  private checkVaryingType(type: Type, decl: GlobalDecl): void {
    const ok =
      (type.kind === "scalar" && type.scalar === "float") ||
      (type.kind === "vector" && type.scalar === "float");
    if (!ok) {
      throw new CompileError(
        decl.line,
        `the varying '${decl.name}' must be a float scalar or vector, got ${typeName(type)} (int/bool varyings would need flat interpolation, which is outside the subset)`,
      );
    }
  }

  /* ---- functions ------------------------------------------------------ */

  private checkFunction(fn: FunctionDecl): void {
    if (this.functions.has(fn.name)) {
      throw new CompileError(
        fn.line,
        `the function '${fn.name}' is already defined (overloading is outside the subset)`,
      );
    }
    if (resolveBuiltinName(fn.name)) {
      throw new CompileError(
        fn.line,
        `'${fn.name}' redefines a built-in function, which is outside the subset; pick another name`,
      );
    }
    for (const param of fn.params) {
      if (param.type.kind === "sampler2D") {
        throw new CompileError(
          param.line,
          `the sampler parameter '${param.name}' is outside the subset; name the sampler uniform directly in the texture() call`,
        );
      }
      if (param.type.kind === "void") {
        throw new CompileError(
          param.line,
          `the parameter '${param.name}' cannot be void`,
        );
      }
    }
    // Registered before the body so a self-call resolves — to a named refusal.
    this.functions.set(fn.name, fn);

    this.currentFunction = fn;
    this.scopes.push();
    for (const param of fn.params) {
      this.scopes.declare(
        param.name,
        {
          type: param.type,
          assignable: true,
          space: "local",
          constValues: null,
        },
        param.line,
      );
    }
    this.checkBlock(fn.body, false);
    this.scopes.pop();
    this.currentFunction = null;
  }

  /* ---- statements ------------------------------------------------------ */

  private checkBlock(block: BlockStmt, newScope = true): void {
    if (newScope) this.scopes.push();
    for (const stmt of block.statements) this.checkStmt(stmt);
    if (newScope) this.scopes.pop();
  }

  private checkStmt(stmt: Stmt): void {
    switch (stmt.node) {
      case "block":
        this.checkBlock(stmt);
        return;
      case "var": {
        if (stmt.type.kind === "void")
          throw new CompileError(stmt.line, "a local variable cannot be void");
        if (stmt.type.kind === "sampler2D") {
          throw new CompileError(
            stmt.line,
            "a sampler2D can only be declared as a uniform",
          );
        }
        for (const decl of stmt.declarators) {
          if (decl.init !== null) {
            const initType = this.checkExpr(decl.init);
            if (!convertible(initType, stmt.type)) {
              throw new CompileError(
                decl.line,
                `cannot initialize ${typeName(stmt.type)} '${decl.name}' from ${typeName(initType)}${initType.kind === "scalar" && initType.scalar === "float" && stmt.type.kind === "scalar" && stmt.type.scalar === "int" ? "; use int(x) to truncate" : ""}`,
              );
            }
          }
          this.scopes.declare(
            decl.name,
            {
              type: stmt.type,
              assignable: !stmt.isConst,
              space: "local",
              constValues: null,
            },
            decl.line,
          );
        }
        return;
      }
      case "assign": {
        const lhsType = this.checkLValue(stmt.lhs);
        const rhsType = this.checkExpr(stmt.rhs);
        if (stmt.op === "=") {
          if (!convertible(rhsType, lhsType)) {
            throw new CompileError(
              stmt.line,
              `cannot assign ${typeName(rhsType)} to ${typeName(lhsType)}`,
            );
          }
          return;
        }
        // Compound assignment types like the underlying binary op, and the
        // result must land back in the lhs type (v *= m is fine, m *= v is not).
        const op = stmt.op.slice(0, 1) as "+" | "-" | "*" | "/";
        const result = this.binaryType(op, lhsType, rhsType, stmt.line);
        if (!sameType(result, lhsType)) {
          throw new CompileError(
            stmt.line,
            `'${stmt.op}' would change the type: ${typeName(lhsType)} ${op} ${typeName(rhsType)} is ${typeName(result)}`,
          );
        }
        return;
      }
      case "if": {
        const condType = this.checkExpr(stmt.cond);
        if (!sameType(condType, BOOL)) {
          throw new CompileError(
            stmt.cond.line,
            `the if condition must be bool, got ${typeName(condType)}`,
          );
        }
        this.checkBlock(stmt.then);
        if (stmt.else !== null) {
          if (stmt.else.node === "if") this.checkStmt(stmt.else);
          else this.checkBlock(stmt.else);
        }
        return;
      }
      case "for":
        this.checkFor(stmt);
        return;
      case "return": {
        const fn = this.currentFunction;
        if (fn === null)
          throw new Error(
            "headless-webgl2: internal: return outside a function",
          );
        if (stmt.value === null) {
          if (fn.returnType.kind !== "void") {
            throw new CompileError(
              stmt.line,
              `'${fn.name}' returns ${typeName(fn.returnType)}; a bare return is not enough`,
            );
          }
          return;
        }
        if (fn.returnType.kind === "void") {
          throw new CompileError(
            stmt.line,
            `'${fn.name}' is void and cannot return a value`,
          );
        }
        const valueType = this.checkExpr(stmt.value);
        if (!convertible(valueType, fn.returnType)) {
          throw new CompileError(
            stmt.line,
            `'${fn.name}' returns ${typeName(fn.returnType)}, got ${typeName(valueType)}`,
          );
        }
        return;
      }
      case "discard": {
        if (this.stage !== "fragment") {
          throw new CompileError(
            stmt.line,
            "'discard' is only available in the fragment shader",
          );
        }
        if (this.currentFunction?.name !== "main") {
          throw new CompileError(
            stmt.line,
            "'discard' outside main is outside the subset; return a flag and discard in main",
          );
        }
        return;
      }
      case "incdec": {
        const symbol = this.scopes.lookup(stmt.name);
        if (symbol === null)
          throw new CompileError(stmt.line, `'${stmt.name}' is not declared`);
        this.requireAssignable(stmt.name, symbol, stmt.line);
        if (!sameType(symbol.type, INT)) {
          throw new CompileError(
            stmt.line,
            `'${stmt.op}' applies to int, and '${stmt.name}' is ${typeName(symbol.type)}`,
          );
        }
        return;
      }
      case "callstmt": {
        this.checkExpr(stmt.call);
        return;
      }
    }
  }

  /**
   * The loop-bound rule (spec §4.3): the counter is a locked int, the bound
   * is a constant or a uniform int scalar, and the step direction matches the
   * comparison — which together make every subset loop provably terminating,
   * with no runtime guard needed.
   */
  private checkFor(stmt: ForStmt): void {
    const decl = stmt.init.declarators[0];
    if (decl === undefined || decl.init === null)
      throw new Error(
        "headless-webgl2: internal: for-loop shape escaped the parser",
      );
    if (!sameType(stmt.init.type, INT)) {
      throw new CompileError(
        stmt.init.line,
        "the for-loop counter must be int",
      );
    }
    const initType = this.checkExpr(decl.init);
    if (!sameType(initType, INT)) {
      throw new CompileError(
        decl.line,
        `the for-loop counter's initializer must be int, got ${typeName(initType)}`,
      );
    }

    // The condition's left side must be the counter itself.
    const cond = stmt.cond;
    if (cond.left.node !== "ident" || cond.left.name !== decl.name) {
      throw new CompileError(
        cond.line,
        `the for-loop condition must have the counter '${decl.name}' on the left`,
      );
    }

    this.scopes.push();
    this.scopes.declare(
      decl.name,
      { type: INT, assignable: false, space: "local", constValues: null },
      decl.line,
    );
    this.lockedCounters.add(decl.name);
    this.types.set(cond.left, INT);

    // The bound: a constant int expression, or a uniform int scalar read.
    const bound = cond.right;
    const boundType = this.checkExpr(bound);
    if (!sameType(boundType, INT)) {
      throw new CompileError(
        bound.line,
        `the for-loop bound must be int, got ${typeName(boundType)}`,
      );
    }
    const isConstBound = this.evalConstInt(bound) !== null;
    const isUniformBound =
      bound.node === "ident" &&
      this.scopes.lookup(bound.name)?.space === "uniform";
    if (!isConstBound && !isUniformBound) {
      throw new CompileError(
        bound.line,
        "the for-loop bound must be a constant expression or a uniform int scalar; anything else is outside the subset (it could not be proven to terminate)",
      );
    }
    this.types.set(cond, BOOL);

    // Direction: an upward comparison needs an upward step and vice versa.
    const upward = cond.op === "<" || cond.op === "<=";
    const update = stmt.update;
    let step: number;
    if (update.amount === null) {
      step = update.op === "++" ? 1 : -1;
    } else {
      const amountType = this.checkExpr(update.amount);
      if (!sameType(amountType, INT)) {
        throw new CompileError(
          update.line,
          `the for-loop step must be int, got ${typeName(amountType)}`,
        );
      }
      const amount = this.evalConstInt(update.amount);
      if (amount === null || amount <= 0) {
        throw new CompileError(
          update.line,
          "the for-loop step must be a constant positive int",
        );
      }
      step = update.op === "+=" ? amount : -amount;
    }
    if (upward !== step > 0) {
      throw new CompileError(
        update.line,
        `the for-loop steps ${step > 0 ? "up" : "down"} but its condition uses '${cond.op}'; the loop would never terminate`,
      );
    }

    this.checkBlock(stmt.body, false);
    this.lockedCounters.delete(decl.name);
    this.scopes.pop();
  }

  private requireAssignable(
    name: string,
    symbol: VarSymbol,
    line: number,
  ): void {
    if (this.lockedCounters.has(name)) {
      throw new CompileError(
        line,
        `the for-loop counter '${name}' cannot be assigned inside the loop; the fixed step is what makes the loop provably bounded`,
      );
    }
    if (!symbol.assignable) {
      const reason =
        symbol.space === "uniform"
          ? "a uniform"
          : symbol.space === "in"
            ? "a shader input"
            : symbol.space === "const"
              ? "a const"
              : "read-only";
      throw new CompileError(
        line,
        `'${name}' is ${reason} and cannot be assigned`,
      );
    }
  }

  /* ---- l-values -------------------------------------------------------- */

  /**
   * Types an l-value and verifies it is one: a variable, a swizzle of one
   * with unique components, or a constant-indexed element/column. A dynamic
   * index on the left is refused — the emitter maps components to scalar JS
   * locals, and the honest alternative (an if-chain per component) buys the
   * engines nothing.
   */
  private checkLValue(expr: Expr): Type {
    switch (expr.node) {
      case "ident": {
        const symbol = this.lookupIdent(expr.name, expr.line);
        this.requireAssignable(expr.name, symbol, expr.line);
        if (symbol.type.kind === "sampler2D") {
          throw new CompileError(expr.line, "a sampler2D cannot be assigned");
        }
        this.types.set(expr, symbol.type);
        return symbol.type;
      }
      case "swizzle": {
        const targetType = this.checkLValue(expr.target);
        const result = this.swizzleType(targetType, expr.components, expr.line);
        const seen = new Set(expr.components);
        if (seen.size !== expr.components.length) {
          throw new CompileError(
            expr.line,
            `the swizzle '.${expr.components}' repeats a component and cannot be assigned`,
          );
        }
        this.types.set(expr, result);
        return result;
      }
      case "index": {
        const targetType = this.checkLValue(expr.target);
        const indexType = this.checkExpr(expr.index);
        if (!sameType(indexType, INT)) {
          throw new CompileError(
            expr.index.line,
            `the index must be int, got ${typeName(indexType)}`,
          );
        }
        const constIndex = this.evalConstInt(expr.index);
        if (constIndex === null) {
          throw new CompileError(
            expr.index.line,
            "assigning through a dynamic index is outside the subset; use a constant index or a swizzle",
          );
        }
        const result = this.indexedType(targetType, constIndex, expr.line);
        this.types.set(expr, result);
        return result;
      }
      default:
        throw new CompileError(
          expr.line,
          "the left side of an assignment must be a variable, a swizzle, or a constant-indexed element",
        );
    }
  }

  /* ---- expressions ------------------------------------------------------ */

  checkExpr(expr: Expr): Type {
    const type = this.typeExpr(expr);
    this.types.set(expr, type);
    // Fold constant ints as we go; the emitter uses them for index emission.
    if (sameType(type, INT)) {
      const folded = this.evalConstInt(expr);
      if (folded !== null) this.constInts.set(expr, folded);
    }
    return type;
  }

  private lookupIdent(name: string, line: number): VarSymbol {
    const stageBuiltins =
      this.stage === "vertex" ? VERTEX_BUILTINS : FRAGMENT_BUILTINS;
    const builtin = stageBuiltins.get(name);
    if (builtin !== undefined) return builtin;
    if (name === "gl_FragDepth") {
      throw new CompileError(
        line,
        "'gl_FragDepth' is outside the subset; depth comes from the interpolated position",
      );
    }
    if (name.startsWith("gl_")) {
      const otherStage = (
        this.stage === "vertex" ? FRAGMENT_BUILTINS : VERTEX_BUILTINS
      ).get(name);
      if (otherStage !== undefined) {
        throw new CompileError(
          line,
          `'${name}' does not exist in the ${this.stage} shader`,
        );
      }
      throw new CompileError(
        line,
        `the built-in '${name}' is outside the subset`,
      );
    }
    const symbol = this.scopes.lookup(name);
    if (symbol === null)
      throw new CompileError(line, `'${name}' is not declared`);
    return symbol;
  }

  private typeExpr(expr: Expr): Type {
    switch (expr.node) {
      case "num":
        return expr.isInt ? INT : FLOAT;
      case "bool":
        return BOOL;
      case "ident": {
        const symbol = this.lookupIdent(expr.name, expr.line);
        if (symbol.type.kind === "sampler2D") {
          throw new CompileError(
            expr.line,
            `the sampler '${expr.name}' can only appear as the sampler argument of texture() or textureLod()`,
          );
        }
        if (symbol.type.kind === "array") {
          throw new CompileError(
            expr.line,
            `the uniform array '${expr.name}' must be indexed; it has no value of its own`,
          );
        }
        return symbol.type;
      }
      case "unary": {
        const operandType = this.checkExpr(expr.operand);
        if (expr.op === "!") {
          if (!sameType(operandType, BOOL)) {
            throw new CompileError(
              expr.line,
              `'!' needs a bool, got ${typeName(operandType)} (use not() for bool vectors)`,
            );
          }
          return BOOL;
        }
        if (operandType.kind === "scalar" && operandType.scalar !== "bool")
          return operandType;
        if (operandType.kind === "vector" && operandType.scalar !== "bool")
          return operandType;
        if (operandType.kind === "matrix") return operandType;
        throw new CompileError(
          expr.line,
          `'${expr.op}' needs a numeric operand, got ${typeName(operandType)}`,
        );
      }
      case "binary": {
        const left = this.checkExpr(expr.left);
        const right = this.checkExpr(expr.right);
        return this.binaryType(expr.op, left, right, expr.line);
      }
      case "ternary": {
        const condType = this.checkExpr(expr.cond);
        if (!sameType(condType, BOOL)) {
          throw new CompileError(
            expr.cond.line,
            `the ?: condition must be bool, got ${typeName(condType)}`,
          );
        }
        const thenType = this.checkExpr(expr.then);
        const elseType = this.checkExpr(expr.else);
        const unified = unify(thenType, elseType);
        if (unified === null) {
          throw new CompileError(
            expr.line,
            `the ?: branches disagree: ${typeName(thenType)} vs ${typeName(elseType)}`,
          );
        }
        return unified;
      }
      case "swizzle": {
        const targetType = this.checkExpr(expr.target);
        return this.swizzleType(targetType, expr.components, expr.line);
      }
      case "index": {
        const targetType = this.indexTargetType(expr.target);
        const indexType = this.checkExpr(expr.index);
        if (!sameType(indexType, INT)) {
          throw new CompileError(
            expr.index.line,
            `the index must be int, got ${typeName(indexType)}`,
          );
        }
        const constIndex = this.evalConstInt(expr.index);
        return this.indexedType(targetType, constIndex, expr.line);
      }
      case "call":
        return this.typeCall(expr);
    }
  }

  /** Types an index target, letting a uniform-array ident through (its bare use is otherwise refused). */
  private indexTargetType(target: Expr): Type {
    if (target.node === "ident") {
      const symbol = this.lookupIdent(target.name, target.line);
      if (symbol.type.kind === "sampler2D") {
        throw new CompileError(
          target.line,
          "sampler arrays are outside the subset",
        );
      }
      this.types.set(target, symbol.type);
      return symbol.type;
    }
    return this.checkExpr(target);
  }

  private indexedType(
    targetType: Type,
    constIndex: number | null,
    line: number,
  ): Type {
    switch (targetType.kind) {
      case "array": {
        if (
          constIndex !== null &&
          (constIndex < 0 || constIndex >= targetType.length)
        ) {
          throw new CompileError(
            line,
            `the index ${constIndex} is out of range for ${typeName(targetType)}`,
          );
        }
        return targetType.element;
      }
      case "vector": {
        if (
          constIndex !== null &&
          (constIndex < 0 || constIndex >= targetType.size)
        ) {
          throw new CompileError(
            line,
            `the index ${constIndex} is out of range for ${typeName(targetType)}`,
          );
        }
        return {
          kind: "scalar",
          scalar: targetType.scalar,
        } satisfies ScalarType;
      }
      case "matrix": {
        if (
          constIndex !== null &&
          (constIndex < 0 || constIndex >= targetType.size)
        ) {
          throw new CompileError(
            line,
            `the column ${constIndex} is out of range for ${typeName(targetType)}`,
          );
        }
        return vec("float", targetType.size);
      }
      default:
        throw new CompileError(
          line,
          `${typeName(targetType)} cannot be indexed`,
        );
    }
  }

  private swizzleType(
    targetType: Type,
    components: string,
    line: number,
  ): Type {
    if (targetType.kind !== "vector") {
      throw new CompileError(
        line,
        `'.${components}' needs a vector, got ${typeName(targetType)} (the subset has no structs, so '.' is always a swizzle)`,
      );
    }
    if (components.length < 1 || components.length > 4) {
      throw new CompileError(
        line,
        `the swizzle '.${components}' must pick 1 to 4 components`,
      );
    }
    const sets = ["xyzw", "rgba", "stpq"];
    const set = sets.find((s) =>
      components[0] === undefined ? false : s.includes(components[0]),
    );
    if (set === undefined) {
      throw new CompileError(
        line,
        `unknown swizzle component '${components[0] ?? ""}'`,
      );
    }
    for (const letter of components) {
      const position = set.indexOf(letter);
      if (position === -1) {
        throw new CompileError(
          line,
          `the swizzle '.${components}' mixes component sets; use only one of xyzw, rgba, stpq`,
        );
      }
      if (position >= targetType.size) {
        throw new CompileError(
          line,
          `the swizzle '.${components}' reaches component '${letter}', which ${typeName(targetType)} does not have`,
        );
      }
    }
    if (components.length === 1)
      return { kind: "scalar", scalar: targetType.scalar };
    return vec(targetType.scalar, components.length as 2 | 3 | 4);
  }

  /** Swizzle letters → component indices; shared with the emitter. */
  static swizzleIndices(components: string): number[] {
    const sets = ["xyzw", "rgba", "stpq"];
    const set =
      sets.find((s) =>
        components[0] === undefined ? false : s.includes(components[0]),
      ) ?? "xyzw";
    return [...components].map((letter) => set.indexOf(letter));
  }

  private binaryType(op: string, left: Type, right: Type, line: number): Type {
    switch (op) {
      case "&&":
      case "||":
      case "^^": {
        if (!sameType(left, BOOL) || !sameType(right, BOOL)) {
          throw new CompileError(
            line,
            `'${op}' needs bool operands, got ${typeName(left)} and ${typeName(right)}`,
          );
        }
        return BOOL;
      }
      case "==":
      case "!=": {
        const unified = unify(left, right);
        if (
          unified === null ||
          unified.kind === "sampler2D" ||
          unified.kind === "array" ||
          unified.kind === "void"
        ) {
          throw new CompileError(
            line,
            `'${op}' cannot compare ${typeName(left)} with ${typeName(right)}`,
          );
        }
        return BOOL;
      }
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const okLeft = left.kind === "scalar" && left.scalar !== "bool";
        const okRight = right.kind === "scalar" && right.scalar !== "bool";
        if (!okLeft || !okRight || unify(left, right) === null) {
          throw new CompileError(
            line,
            `'${op}' compares numeric scalars, got ${typeName(left)} and ${typeName(right)} (use lessThan()/greaterThan() for vectors)`,
          );
        }
        return BOOL;
      }
      case "%": {
        const isIntShape = (t: Type): boolean =>
          (t.kind === "scalar" || t.kind === "vector") && t.scalar === "int";
        if (
          !isIntShape(left) ||
          !isIntShape(right) ||
          unify(left, right) === null
        ) {
          throw new CompileError(
            line,
            `'%' applies to int operands, got ${typeName(left)} and ${typeName(right)}; use mod() for floats`,
          );
        }
        return left;
      }
      case "+":
      case "-":
      case "*":
      case "/":
        return this.arithmeticType(op, left, right, line);
      default:
        throw new Error(
          `headless-webgl2: internal: unknown binary operator '${op}'`,
        );
    }
  }

  private arithmeticType(
    op: string,
    left: Type,
    right: Type,
    line: number,
  ): Type {
    const reject = (): never => {
      throw new CompileError(
        line,
        `'${op}' cannot combine ${typeName(left)} and ${typeName(right)}`,
      );
    };
    const isBoolish = (t: Type): boolean =>
      (t.kind === "scalar" || t.kind === "vector") && t.scalar === "bool";
    if (isBoolish(left) || isBoolish(right)) reject();

    // Matrix algebra: linear-algebra product for `*`, componentwise otherwise.
    if (left.kind === "matrix" || right.kind === "matrix") {
      if (left.kind === "matrix" && right.kind === "matrix") {
        if (left.size !== right.size) reject();
        return left;
      }
      const matrix = (left.kind === "matrix" ? left : right) as MatrixType;
      const other = left.kind === "matrix" ? right : left;
      if (other.kind === "scalar") {
        if (other.scalar === "bool") reject();
        return matrix;
      }
      if (op === "*" && other.kind === "vector" && other.scalar !== "bool") {
        if (other.size !== matrix.size) reject();
        return vec("float", matrix.size);
      }
      reject();
    }

    if (left.kind === "scalar" && right.kind === "scalar") {
      const unified = unify(left, right);
      if (unified === null) reject();
      return unified as Type;
    }
    if (left.kind === "vector" && right.kind === "vector") {
      if (left.size !== right.size) reject();
      const unified = unify(left, right);
      if (unified === null) reject();
      return unified as Type;
    }
    if (left.kind === "vector" && right.kind === "scalar") {
      const scalarKind = unify({ kind: "scalar", scalar: left.scalar }, right);
      if (scalarKind === null) reject();
      return vec((scalarKind as ScalarType).scalar, left.size);
    }
    if (left.kind === "scalar" && right.kind === "vector") {
      const scalarKind = unify(left, { kind: "scalar", scalar: right.scalar });
      if (scalarKind === null) reject();
      return vec((scalarKind as ScalarType).scalar, right.size);
    }
    reject();
    throw new Error("unreachable");
  }

  /* ---- calls ------------------------------------------------------------ */

  private typeCall(call: Call): Type {
    // Excluded builtins refuse before argument checking, so `texelFetch(u_map,
    // ...)` names texelFetch rather than tripping over the sampler argument.
    const excludedReason = EXCLUDED_FUNCTIONS.get(call.callee);
    if (excludedReason !== undefined && !this.functions.has(call.callee)) {
      throw new CompileError(call.line, excludedReason);
    }

    // Constructors: the callee is a type spelling.
    const constructed = constructorType(call.callee);
    if (constructed !== null) {
      return this.typeConstructor(call, constructed);
    }

    // Texture lookups: the sampler argument is validated by shape here (it
    // must name a sampler uniform directly), then the signature by type.
    if (call.callee === "texture" || call.callee === "textureLod") {
      const samplerArg = call.args[0];
      if (samplerArg === undefined || samplerArg.node !== "ident") {
        throw new CompileError(
          call.line,
          `the first argument of ${call.callee}() must name a sampler2D uniform directly`,
        );
      }
      const symbol = this.scopes.lookup(samplerArg.name);
      if (symbol === null || symbol.type.kind !== "sampler2D") {
        throw new CompileError(
          samplerArg.line,
          `'${samplerArg.name}' is not a sampler2D uniform`,
        );
      }
      this.types.set(samplerArg, symbol.type);
      const argTypes: Type[] = [symbol.type];
      for (const arg of call.args.slice(1)) argTypes.push(this.checkExpr(arg));
      const result = resolveBuiltin(call.callee, argTypes, call.line);
      if (result === null)
        throw new Error("headless-webgl2: internal: texture builtin vanished");
      return result;
    }

    // User functions take precedence over nothing: builtins are checked
    // first only through the exclusion list, and a user name shadowing a
    // builtin was refused at definition, so the order cannot collide.
    const userFn = this.functions.get(call.callee);
    if (userFn !== undefined) {
      if (
        this.currentFunction !== null &&
        call.callee === this.currentFunction.name
      ) {
        throw new CompileError(
          call.line,
          `'${call.callee}' calls itself; recursion is outside the subset`,
        );
      }
      if (call.args.length !== userFn.params.length) {
        throw new CompileError(
          call.line,
          `'${call.callee}' takes ${userFn.params.length} argument(s), got ${call.args.length}`,
        );
      }
      for (let i = 0; i < call.args.length; i += 1) {
        const arg = call.args[i];
        const param = userFn.params[i];
        if (arg === undefined || param === undefined) continue;
        const argType = this.checkExpr(arg);
        if (!convertible(argType, param.type)) {
          throw new CompileError(
            arg.line,
            `argument ${i + 1} of '${call.callee}' must be ${typeName(param.type)}, got ${typeName(argType)}`,
          );
        }
      }
      return userFn.returnType;
    }

    const argTypes = call.args.map((arg) => this.checkExpr(arg));
    const builtinResult = resolveBuiltin(call.callee, argTypes, call.line);
    if (builtinResult !== null) return builtinResult;

    if (EXCLUDED_FUNCTIONS.has(call.callee)) {
      throw new CompileError(
        call.line,
        EXCLUDED_FUNCTIONS.get(call.callee) ?? "",
      );
    }
    throw new CompileError(
      call.line,
      `unknown function '${call.callee}' (helper functions must be defined above their first call)`,
    );
  }

  private typeConstructor(call: Call, target: Type): Type {
    const argTypes = call.args.map((arg) => {
      const argType = this.checkExpr(arg);
      if (
        argType.kind === "sampler2D" ||
        argType.kind === "array" ||
        argType.kind === "void"
      ) {
        throw new CompileError(
          arg.line,
          `${typeName(argType)} cannot appear in a constructor`,
        );
      }
      return argType;
    });
    if (argTypes.length === 0) {
      throw new CompileError(
        call.line,
        `the ${typeName(target)} constructor needs arguments`,
      );
    }
    const first = argTypes[0] as Type;

    if (target.kind === "scalar") {
      if (argTypes.length !== 1 || first.kind !== "scalar") {
        throw new CompileError(
          call.line,
          `the ${typeName(target)} constructor takes exactly one scalar`,
        );
      }
      return target;
    }

    if (target.kind === "vector") {
      // A single scalar splats; otherwise the flattened components must fill
      // the vector exactly (matrices cannot appear in a vector constructor).
      if (argTypes.length === 1 && first.kind === "scalar") return target;
      let total = 0;
      for (const argType of argTypes) {
        if (argType.kind === "matrix") {
          throw new CompileError(
            call.line,
            `a matrix cannot appear in a ${typeName(target)} constructor`,
          );
        }
        total += componentCount(argType);
      }
      if (total !== target.size) {
        throw new CompileError(
          call.line,
          `the ${typeName(target)} constructor needs exactly ${target.size} components, got ${total}`,
        );
      }
      return target;
    }

    if (target.kind === "matrix") {
      if (argTypes.length === 1 && first.kind === "scalar") return target; // diagonal
      if (argTypes.length === 1 && first.kind === "matrix") return target; // resize
      let total = 0;
      for (const argType of argTypes) {
        if (argType.kind === "matrix") {
          throw new CompileError(
            call.line,
            `a matrix can only be the sole argument of a ${typeName(target)} constructor`,
          );
        }
        total += componentCount(argType);
      }
      if (total !== target.size * target.size) {
        throw new CompileError(
          call.line,
          `the ${typeName(target)} constructor needs exactly ${target.size * target.size} components (column-major), got ${total}`,
        );
      }
      return target;
    }

    throw new CompileError(call.line, `${typeName(target)} has no constructor`);
  }

  /* ---- const evaluation -------------------------------------------------- */

  /** Folds a constant int expression, or null when it is not one. */
  evalConstInt(expr: Expr): number | null {
    const values = this.evalConst(expr, INT);
    if (values === null || values.length !== 1) return null;
    const value = values[0];
    return value !== undefined && Number.isInteger(value) ? value : null;
  }

  /**
   * Evaluates a constant expression to its flat component values, or null if
   * anything non-constant appears. `expected` only guides int/float literal
   * acceptance; shape errors were already caught by typing.
   */
  private evalConst(
    expr: Expr,
    expected: Type | null,
  ): readonly number[] | null {
    switch (expr.node) {
      case "num":
        return [expr.value];
      case "bool":
        return [expr.value ? 1 : 0];
      case "ident": {
        const symbol = this.scopes.lookup(expr.name);
        return symbol?.constValues ?? null;
      }
      case "unary": {
        const operand = this.evalConst(expr.operand, expected);
        if (operand === null) return null;
        if (expr.op === "-") return operand.map((v) => -v);
        if (expr.op === "+") return [...operand];
        return operand.map((v) => (v === 0 ? 1 : 0));
      }
      case "binary": {
        const left = this.evalConst(expr.left, expected);
        const right = this.evalConst(expr.right, expected);
        if (left === null || right === null) return null;
        const leftType = this.types.get(expr.left);
        const isIntOp =
          leftType !== undefined &&
          (leftType.kind === "scalar" || leftType.kind === "vector") &&
          leftType.scalar === "int" &&
          this.types.get(expr.right) !== undefined &&
          sameType(this.types.get(expr.right) as Type, leftType);
        const a =
          left.length === 1 && right.length > 1
            ? Array.from(right, () => left[0] as number)
            : left;
        const b =
          right.length === 1 && left.length > 1
            ? Array.from(left, () => right[0] as number)
            : right;
        if (a.length !== b.length) return null;
        const combine = (x: number, y: number): number | null => {
          switch (expr.op) {
            case "+":
              return x + y;
            case "-":
              return x - y;
            case "*":
              return x * y;
            case "/":
              return isIntOp ? Math.trunc(x / y) : x / y;
            case "%":
              return x % y;
            default:
              return null;
          }
        };
        const out: number[] = [];
        for (let i = 0; i < a.length; i += 1) {
          const combined = combine(a[i] as number, b[i] as number);
          if (combined === null || !Number.isFinite(combined)) return null;
          out.push(combined);
        }
        return out;
      }
      case "call": {
        // Constructors of constants fold; everything else does not.
        const target = constructorType(expr.callee);
        if (target === null) return null;
        const parts: number[] = [];
        for (const arg of expr.args) {
          const argValues = this.evalConst(arg, null);
          if (argValues === null) return null;
          parts.push(...argValues);
        }
        const want = componentCount(target);
        if (target.kind === "scalar") {
          const value = parts[0] ?? 0;
          return [
            target.scalar === "int"
              ? Math.trunc(value)
              : target.scalar === "bool"
                ? value === 0
                  ? 0
                  : 1
                : value,
          ];
        }
        if (parts.length === 1) {
          if (target.kind === "matrix") {
            const out = new Array<number>(want).fill(0);
            for (let i = 0; i < target.size; i += 1)
              out[i * target.size + i] = parts[0] as number;
            return out;
          }
          return new Array<number>(want).fill(parts[0] as number);
        }
        return parts.length === want ? parts : null;
      }
      case "swizzle": {
        const target = this.evalConst(expr.target, null);
        if (target === null) return null;
        const indices = Checker.swizzleIndices(expr.components);
        const out: number[] = [];
        for (const i of indices) {
          const value = target[i];
          if (value === undefined) return null;
          out.push(value);
        }
        return out;
      }
      default:
        return null;
    }
  }
}

/** int → float unification (GLSL ES 3.00's only implicit conversion); null when the types disagree. */
function unify(a: Type, b: Type): Type | null {
  if (sameType(a, b)) return a;
  if (convertible(a, b)) return b;
  if (convertible(b, a)) return a;
  return null;
}

/** The type a constructor spelling builds, or null when the callee is not a type. */
function constructorType(callee: string): Type | null {
  switch (callee) {
    case "float":
      return FLOAT;
    case "int":
      return INT;
    case "bool":
      return BOOL;
    case "vec2":
      return vec("float", 2);
    case "vec3":
      return vec("float", 3);
    case "vec4":
      return vec("float", 4);
    case "ivec2":
      return vec("int", 2);
    case "ivec3":
      return vec("int", 3);
    case "ivec4":
      return vec("int", 4);
    case "bvec2":
      return vec("bool", 2);
    case "bvec3":
      return vec("bool", 3);
    case "bvec4":
      return vec("bool", 4);
    case "mat3":
      return mat(3);
    case "mat4":
      return mat(4);
    default:
      return null;
  }
}

/** True when the name resolves as a builtin (used to refuse user redefinitions). */
function resolveBuiltinName(name: string): boolean {
  if (EXCLUDED_FUNCTIONS.has(name)) return true;
  try {
    // Probing with an empty signature: a builtin name fails with a CompileError
    // (no overload), a non-builtin returns null — which is the discriminator.
    return resolveBuiltin(name, [], 0) !== null;
  } catch {
    return true;
  }
}

export { constructorType, unify };
export type { VectorType };

/**
 * Compiles one shader stage: parse, then check. Returns the checked shader
 * for the linker, or throws CompileError with the first error found.
 */
export function checkShader(source: string, stage: Stage): CheckedShader {
  const ast = parse(source);
  const checker = new Checker(stage);
  checker.check(ast);
  return {
    stage,
    ast,
    ins: checker.ins,
    outs: checker.outs,
    uniforms: checker.uniforms,
    consts: checker.consts,
    functions: checker.functions,
    types: checker.types,
    constInts: checker.constInts,
  };
}

/** Swizzle letters → indices, re-exported for the emitter. */
export const swizzleIndices = Checker.swizzleIndices;
