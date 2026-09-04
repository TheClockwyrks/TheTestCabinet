/**
 * JS code generation from a checked shader AST. One execution engine exists —
 * this emitter plus `new Function` — no interpreter, per the spec's execution
 * model: codegen is barely harder once the checker exists, and it is what
 * keeps 120-frame validator runs comfortable.
 *
 * The generated code is flat scalar arithmetic: every GLSL value is a set of
 * JS number/boolean expressions, one per component, and vectors never exist
 * as runtime objects — so a fragment invocation allocates nothing. The only
 * heap objects in generated code are the per-function return scratches
 * (allocated once at compile time; safe to reuse because the checker refused
 * recursion) and the sampler result views (owned and reused by the sampler
 * functions stage 3 supplies, copied into scalars immediately after each
 * call).
 *
 * All math is f64 (spec §5.6): no Math.fround, no Float32Array temporaries in
 * expressions — deliberately more precise than GPU f32 and bit-deterministic.
 */

import { componentCount, sameType } from "./ast";
import type {
  AssignStmt,
  BlockStmt,
  Call,
  Expr,
  ForStmt,
  FunctionDecl,
  IfStmt,
  Stmt,
  Type,
} from "./ast";
import { swizzleIndices, type CheckedShader } from "./check";

/* ------------------------------------------------------------------------ */
/* Layout: where the linker put every global                                */
/* ------------------------------------------------------------------------ */

/** The register-file layout the linker assigned; the emitter turns it into storage strings. */
export interface StageLayout {
  /** Vertex only: attribute name → location. Each location spans 4 slots of the `A` file. */
  readonly attributeLocations: ReadonlyMap<string, number>;
  /** Varying name → component offset in the `V` file (matched across stages by the linker). */
  readonly varyingOffsets: ReadonlyMap<string, number>;
  /** Uniform name → base slot in the flat f64 uniform store `U`. */
  readonly uniformSlots: ReadonlyMap<string, number>;
}

/** A value under emission: its type and one JS expression per component. */
interface Val {
  readonly type: Type;
  readonly comps: readonly string[];
}

/** Storage for a name: assignable component l-values, or a uniform array's base slot. */
type Storage =
  | {
      readonly kind: "comps";
      readonly type: Type;
      readonly comps: readonly string[];
    }
  | {
      readonly kind: "uniformArray";
      readonly type: Type;
      readonly base: number;
    };

/** A component expression cheap enough to duplicate: a name, an indexed register, or a literal. */
const SIMPLE =
  /^(?:[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\[\d+\]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false)$/;

class Emitter {
  private readonly checked: CheckedShader;
  private readonly layout: StageLayout;
  /** Top-level lines: scratch allocations and helper function definitions. */
  private readonly top: string[] = [];
  /** The current function body's lines. */
  private body: string[] = [];
  private readonly env: Map<string, Storage>[] = [new Map()];
  private tempId = 0;
  private localId = 0;
  private currentFunction: FunctionDecl | null = null;

  constructor(checked: CheckedShader, layout: StageLayout) {
    this.checked = checked;
    this.layout = layout;
  }

  /* ---- plumbing ------------------------------------------------------ */

  private t(expr: Expr): Type {
    const type = this.checked.types.get(expr);
    if (type === undefined)
      throw new Error(
        "headless-webgl2: internal: an expression escaped the checker unannotated",
      );
    return type;
  }

  private temp(): string {
    this.tempId += 1;
    return `_t${this.tempId}`;
  }

  private line(text: string): void {
    this.body.push(text);
  }

  /** Materializes non-trivial components into const temps so formulas can reuse them safely. */
  private save(val: Val): Val {
    const comps = val.comps.map((comp) => {
      if (SIMPLE.test(comp)) return comp;
      const name = this.temp();
      this.line(`const ${name} = ${comp};`);
      return name;
    });
    return { type: val.type, comps };
  }

  /**
   * Copies every component into a fresh temp, even trivial ones — the
   * aliasing barrier: `v.xy = v.yx` must read both old values before either
   * store, and a "simple" component is exactly the kind that can alias.
   */
  private forceSave(val: Val): Val {
    const comps = val.comps.map((comp) => {
      const name = this.temp();
      this.line(`const ${name} = ${comp};`);
      return name;
    });
    return { type: val.type, comps };
  }

  private pushScope(): void {
    this.env.push(new Map());
  }

  private popScope(): void {
    this.env.pop();
  }

  private declare(name: string, storage: Storage): void {
    this.env[this.env.length - 1]?.set(name, storage);
  }

  private lookup(name: string): Storage {
    for (let i = this.env.length - 1; i >= 0; i -= 1) {
      const found = this.env[i]?.get(name);
      if (found !== undefined) return found;
    }
    throw new Error(
      `headless-webgl2: internal: '${name}' escaped the checker undeclared`,
    );
  }

  /* ---- entry --------------------------------------------------------- */

  /**
   * Emits the whole stage as a JS source string whose evaluation yields the
   * stage function.
   *
   * The register files (`A`, `U`, `V`, …) are outer `let` bindings the stage
   * function refills from its parameters on every invocation, rather than the
   * parameters themselves — because helper functions are defined once at the
   * outer scope (so a fragment invocation allocates no closures) yet still
   * reference uniforms, varyings, and the stage built-ins, and a free `U`
   * inside a top-level helper can only resolve to an outer binding.
   */
  emit(): string {
    this.seedGlobals();

    for (const fn of this.checked.ast.functions) {
      if (fn.name === "main") continue;
      this.emitFunction(fn);
    }

    const main = this.checked.ast.functions.find((fn) => fn.name === "main");
    if (main === undefined)
      throw new Error("headless-webgl2: internal: main escaped the checker");

    this.currentFunction = main;
    this.body = [];
    this.pushScope();
    if (this.checked.stage === "vertex") {
      // gl_PointSize is accepted and discarded: points raster as 1×1 (spec
      // §3.7). Reset per invocation so one vertex's write never leaks into
      // the next — the GLSL contract for an unwritten built-in output.
      this.line("_pointSize = 1;");
    }
    this.emitBlock(main.body, false);
    this.popScope();

    const mainBody = this.body.join("\n");
    const files =
      this.checked.stage === "vertex"
        ? ["A", "U", "SMP", "V", "P"]
        : ["V", "U", "SMP", "FC", "FF", "O"];
    const outerLets = [
      ...files,
      ...(this.checked.stage === "vertex" ? ["_pointSize"] : []),
    ];
    const params = files.map((name) => `_${name}`);
    const refill = files.map((name, i) => `${name} = ${params[i]};`).join(" ");
    const tail = this.checked.stage === "fragment" ? "\nreturn false;" : "";
    return `"use strict";\nlet ${outerLets.join(", ")};\n${this.top.join("\n")}\nreturn function (${params.join(", ")}) {\n${refill}\n${mainBody}${tail}\n};`;
  }

  /** Binds every global name to its storage: register-file reads, inlined consts, builtins. */
  private seedGlobals(): void {
    const stage = this.checked.stage;

    for (const info of this.checked.ins) {
      if (stage === "vertex") {
        const location = this.layout.attributeLocations.get(info.name);
        if (location === undefined)
          throw new Error(
            `headless-webgl2: internal: the attribute '${info.name}' has no location`,
          );
        const comps = Array.from(
          { length: componentCount(info.type) },
          (_, c) => `A[${location * 4 + c}]`,
        );
        this.declare(info.name, { kind: "comps", type: info.type, comps });
      } else {
        const offset = this.layout.varyingOffsets.get(info.name);
        if (offset === undefined)
          throw new Error(
            `headless-webgl2: internal: the varying '${info.name}' has no offset`,
          );
        const comps = Array.from(
          { length: componentCount(info.type) },
          (_, c) => `V[${offset + c}]`,
        );
        this.declare(info.name, { kind: "comps", type: info.type, comps });
      }
    }

    for (const info of this.checked.outs) {
      if (stage === "vertex") {
        const offset = this.layout.varyingOffsets.get(info.name);
        if (offset === undefined)
          throw new Error(
            `headless-webgl2: internal: the varying '${info.name}' has no offset`,
          );
        const comps = Array.from(
          { length: componentCount(info.type) },
          (_, c) => `V[${offset + c}]`,
        );
        this.declare(info.name, { kind: "comps", type: info.type, comps });
      } else {
        this.declare(info.name, {
          kind: "comps",
          type: info.type,
          comps: ["O[0]", "O[1]", "O[2]", "O[3]"],
        });
      }
    }

    for (const info of this.checked.uniforms) {
      const slot = this.layout.uniformSlots.get(info.name);
      if (slot === undefined)
        throw new Error(
          `headless-webgl2: internal: the uniform '${info.name}' has no slot`,
        );
      if (info.type.kind === "array") {
        this.declare(info.name, {
          kind: "uniformArray",
          type: info.type,
          base: slot,
        });
      } else {
        // A bool uniform's store slot holds 0/1 as a number; the read is
        // wrapped to a real JS boolean so `u_flag == false` compares under
        // strict equality instead of always missing on number-vs-boolean.
        const wrapBool = isBoolShaped(info.type);
        const comps = Array.from(
          { length: componentCount(info.type) },
          (_, c) => (wrapBool ? `(U[${slot + c}] !== 0)` : `U[${slot + c}]`),
        );
        this.declare(info.name, { kind: "comps", type: info.type, comps });
      }
    }

    for (const [name, constant] of this.checked.consts) {
      const isBool =
        (constant.type.kind === "scalar" || constant.type.kind === "vector") &&
        constant.type.scalar === "bool";
      const comps = constant.values.map((v) =>
        isBool ? (v !== 0 ? "true" : "false") : numToJs(v),
      );
      this.declare(name, { kind: "comps", type: constant.type, comps });
    }

    if (stage === "vertex") {
      this.declare("gl_Position", {
        kind: "comps",
        type: { kind: "vector", scalar: "float", size: 4 },
        comps: ["P[0]", "P[1]", "P[2]", "P[3]"],
      });
      this.declare("gl_PointSize", {
        kind: "comps",
        type: { kind: "scalar", scalar: "float" },
        comps: ["_pointSize"],
      });
    } else {
      this.declare("gl_FragCoord", {
        kind: "comps",
        type: { kind: "vector", scalar: "float", size: 4 },
        comps: ["FC[0]", "FC[1]", "FC[2]", "FC[3]"],
      });
      this.declare("gl_FrontFacing", {
        kind: "comps",
        type: { kind: "scalar", scalar: "bool" },
        comps: ["FF"],
      });
    }
  }

  /* ---- functions ------------------------------------------------------ */

  private emitFunction(fn: FunctionDecl): void {
    this.currentFunction = fn;
    this.body = [];
    this.pushScope();

    const paramNames: string[] = [];
    for (const param of fn.params) {
      const count = componentCount(param.type);
      this.localId += 1;
      const comps = Array.from(
        { length: count },
        (_, c) => `_p${this.localId}_${c}`,
      );
      paramNames.push(...comps);
      this.declare(param.name, { kind: "comps", type: param.type, comps });
    }

    const returnComponents = componentCount(fn.returnType);
    if (returnComponents > 1) {
      // The per-function return scratch: one allocation per compile, reusable
      // because recursion was refused — a call chain never re-enters a frame.
      this.top.push(
        `const _R_${fn.name} = new Float64Array(${returnComponents});`,
      );
    }

    this.emitBlock(fn.body, false);
    this.popScope();

    this.top.push(`function _f_${fn.name}(${paramNames.join(", ")}) {`);
    this.top.push(this.body.join("\n"));
    this.top.push("}");
    this.currentFunction = null;
    this.body = [];
  }

  /* ---- statements ------------------------------------------------------ */

  private emitBlock(block: BlockStmt, ownScope = true): void {
    if (ownScope) this.pushScope();
    for (const stmt of block.statements) this.emitStmt(stmt);
    if (ownScope) this.popScope();
  }

  private emitStmt(stmt: Stmt): void {
    switch (stmt.node) {
      case "block":
        // No JS braces needed: every local name is globally unique.
        this.emitBlock(stmt);
        return;
      case "var": {
        for (const decl of stmt.declarators) {
          const count = componentCount(stmt.type);
          this.localId += 1;
          const comps = Array.from(
            { length: count },
            (_, c) => `_v${this.localId}_${c}`,
          );
          if (decl.init !== null) {
            const init = this.emitExpr(decl.init);
            const converted = this.convert(init, stmt.type);
            for (let c = 0; c < count; c += 1)
              this.line(`let ${comps[c]} = ${converted.comps[c]};`);
          } else {
            const zero =
              (stmt.type.kind === "scalar" || stmt.type.kind === "vector") &&
              stmt.type.scalar === "bool"
                ? "false"
                : "0";
            for (let c = 0; c < count; c += 1)
              this.line(`let ${comps[c]} = ${zero};`);
          }
          this.declare(decl.name, { kind: "comps", type: stmt.type, comps });
        }
        return;
      }
      case "assign":
        this.emitAssign(stmt);
        return;
      case "if":
        this.emitIf(stmt);
        return;
      case "for":
        this.emitFor(stmt);
        return;
      case "return": {
        const fn = this.currentFunction;
        if (fn === null)
          throw new Error(
            "headless-webgl2: internal: return outside a function",
          );
        if (stmt.value === null) {
          this.line(
            fn.name === "main" && this.checked.stage === "fragment"
              ? "return false;"
              : "return;",
          );
          return;
        }
        const value = this.convert(this.emitExpr(stmt.value), fn.returnType);
        if (value.comps.length === 1) {
          this.line(`return ${value.comps[0]};`);
        } else {
          const saved = this.save(value);
          for (let c = 0; c < saved.comps.length; c += 1)
            this.line(`_R_${fn.name}[${c}] = ${saved.comps[c]};`);
          this.line(`return _R_${fn.name};`);
        }
        return;
      }
      case "discard":
        this.line("return true;");
        return;
      case "incdec": {
        const storage = this.lookup(stmt.name);
        if (storage.kind !== "comps")
          throw new Error("headless-webgl2: internal: incdec on a non-scalar");
        this.line(`${storage.comps[0]}${stmt.op};`);
        return;
      }
      case "callstmt":
        this.emitExpr(stmt.call);
        return;
    }
  }

  private emitAssign(stmt: AssignStmt): void {
    const lhsType = this.t(stmt.lhs);
    const lhs = this.resolveLValue(stmt.lhs);
    if (stmt.op === "=") {
      const rhs = this.convert(this.emitExpr(stmt.rhs), lhsType);
      // Force-copied before writing: `v.xy = v.yx` must read the old values.
      const saved = lhs.length > 1 ? this.forceSave(rhs) : rhs;
      for (let c = 0; c < lhs.length; c += 1)
        this.line(`${lhs[c]} = ${saved.comps[c]};`);
      return;
    }
    // Compound assignment: compute lhs ∘ rhs into temps, then store — the
    // copy step is what makes aliasing (m *= m) read consistent old values.
    const op = stmt.op.slice(0, 1) as "+" | "-" | "*" | "/";
    const lhsVal = { type: lhsType, comps: lhs };
    const rhs = this.emitExpr(stmt.rhs);
    const result = this.emitArithmetic(op, lhsVal, rhs, lhsType);
    const saved = this.forceSave(result);
    for (let c = 0; c < lhs.length; c += 1)
      this.line(`${lhs[c]} = ${saved.comps[c]};`);
  }

  private emitIf(stmt: IfStmt): void {
    const cond = this.emitExpr(stmt.cond);
    this.line(`if (${cond.comps[0]}) {`);
    this.emitBlock(stmt.then);
    if (stmt.else !== null) {
      // The else branch opens its own JS block so a nested else-if's condition
      // preamble runs only when the outer condition failed.
      this.line("} else {");
      if (stmt.else.node === "if") this.emitIf(stmt.else);
      else this.emitBlock(stmt.else);
    }
    this.line("}");
  }

  private emitFor(stmt: ForStmt): void {
    const decl = stmt.init.declarators[0];
    if (decl === undefined || decl.init === null)
      throw new Error(
        "headless-webgl2: internal: for shape escaped the checker",
      );
    this.pushScope();
    this.localId += 1;
    const counter = `_v${this.localId}_0`;
    this.declare(decl.name, {
      kind: "comps",
      type: { kind: "scalar", scalar: "int" },
      comps: [counter],
    });

    const init = this.emitExpr(decl.init);
    // The bound is a constant or a uniform read — loop-invariant either way,
    // so it is evaluated once before the loop.
    const bound = this.save(this.emitExpr(stmt.cond.right));
    const update =
      stmt.update.amount === null
        ? `${counter}${stmt.update.op}`
        : `${counter} ${stmt.update.op} ${this.checked.constInts.get(stmt.update.amount) ?? 1}`;
    this.line(
      `for (let ${counter} = ${init.comps[0]}; ${counter} ${stmt.cond.op} ${bound.comps[0]}; ${update}) {`,
    );
    this.emitBlock(stmt.body, false);
    this.line("}");
    this.popScope();
  }

  /* ---- l-values -------------------------------------------------------- */

  private resolveLValue(expr: Expr): string[] {
    switch (expr.node) {
      case "ident": {
        const storage = this.lookup(expr.name);
        if (storage.kind !== "comps")
          throw new Error(
            "headless-webgl2: internal: array l-value escaped the checker",
          );
        return [...storage.comps];
      }
      case "swizzle": {
        const target = this.resolveLValue(expr.target);
        return swizzleIndices(expr.components).map((i) => target[i] ?? "0");
      }
      case "index": {
        const target = this.resolveLValue(expr.target);
        const index = this.checked.constInts.get(expr.index);
        if (index === undefined)
          throw new Error(
            "headless-webgl2: internal: dynamic l-value index escaped the checker",
          );
        const targetType = this.t(expr.target);
        if (targetType.kind === "matrix") {
          return target.slice(
            index * targetType.size,
            (index + 1) * targetType.size,
          );
        }
        return [target[index] ?? "0"];
      }
      default:
        throw new Error(
          "headless-webgl2: internal: a non-l-value escaped the checker",
        );
    }
  }

  /* ---- expressions ------------------------------------------------------ */

  private emitExpr(expr: Expr): Val {
    switch (expr.node) {
      case "num":
        return { type: this.t(expr), comps: [numToJs(expr.value)] };
      case "bool":
        return { type: this.t(expr), comps: [expr.value ? "true" : "false"] };
      case "ident": {
        const storage = this.lookup(expr.name);
        if (storage.kind !== "comps")
          throw new Error(
            "headless-webgl2: internal: bare array read escaped the checker",
          );
        return { type: storage.type, comps: [...storage.comps] };
      }
      case "unary": {
        const operand = this.emitExpr(expr.operand);
        if (expr.op === "!")
          return { type: this.t(expr), comps: [`!(${operand.comps[0]})`] };
        if (expr.op === "+")
          return { type: this.t(expr), comps: [...operand.comps] };
        return {
          type: this.t(expr),
          comps: operand.comps.map((c) => `(-${wrap(c)})`),
        };
      }
      case "binary":
        return this.emitBinary(expr);
      case "ternary": {
        const cond = this.save(this.emitExpr(expr.cond));
        const resultType = this.t(expr);
        const then = this.convert(this.emitExpr(expr.then), resultType);
        const elseVal = this.convert(this.emitExpr(expr.else), resultType);
        const comps = then.comps.map(
          (c, i) => `(${cond.comps[0]} ? ${c} : ${elseVal.comps[i]})`,
        );
        return { type: resultType, comps };
      }
      case "swizzle": {
        const target = this.emitExpr(expr.target);
        const comps = swizzleIndices(expr.components).map(
          (i) => target.comps[i] ?? "0",
        );
        return { type: this.t(expr), comps };
      }
      case "index":
        return this.emitIndex(expr);
      case "call":
        return this.emitCall(expr);
    }
  }

  private emitIndex(expr: Extract<Expr, { node: "index" }>): Val {
    const resultType = this.t(expr);
    const targetType = this.t(expr.target);
    const constIndex = this.checked.constInts.get(expr.index);

    // Uniform arrays index straight into the flat store; a dynamic index is
    // clamped into range, the deterministic reading of GLSL's undefined
    // out-of-bounds access.
    if (targetType.kind === "array") {
      if (expr.target.node !== "ident")
        throw new Error(
          "headless-webgl2: internal: array expression escaped the checker",
        );
      const storage = this.lookup(expr.target.name);
      if (storage.kind !== "uniformArray")
        throw new Error(
          "headless-webgl2: internal: array without array storage",
        );
      const stride = componentCount(targetType.element);
      // Bool elements are wrapped to real JS booleans, same as bool uniforms.
      const asBool = isBoolShaped(targetType.element);
      const read = (comp: string): string =>
        asBool ? `(${comp} !== 0)` : comp;
      if (constIndex !== undefined) {
        const base = storage.base + constIndex * stride;
        return {
          type: resultType,
          comps: Array.from({ length: stride }, (_, c) =>
            read(`U[${base + c}]`),
          ),
        };
      }
      const index = this.emitExpr(expr.index);
      const clamped = this.temp();
      this.line(
        `const ${clamped} = Math.min(Math.max(${index.comps[0]}, 0), ${targetType.length - 1});`,
      );
      return {
        type: resultType,
        comps: Array.from({ length: stride }, (_, c) =>
          read(`U[${storage.base} + ${clamped} * ${stride} + ${c}]`),
        ),
      };
    }

    if (targetType.kind === "vector") {
      const target = this.emitExpr(expr.target);
      if (constIndex !== undefined)
        return { type: resultType, comps: [target.comps[constIndex] ?? "0"] };
      const saved = this.save(target);
      const index = this.save(this.emitExpr(expr.index));
      return {
        type: resultType,
        comps: [selectChain(index.comps[0] ?? "0", saved.comps)],
      };
    }

    if (targetType.kind === "matrix") {
      const size = targetType.size;
      const target = this.emitExpr(expr.target);
      if (constIndex !== undefined) {
        return {
          type: resultType,
          comps: target.comps.slice(constIndex * size, (constIndex + 1) * size),
        };
      }
      const saved = this.save(target);
      const index = this.save(this.emitExpr(expr.index));
      const comps = Array.from({ length: size }, (_, row) =>
        selectChain(
          index.comps[0] ?? "0",
          Array.from(
            { length: size },
            (_, col) => saved.comps[col * size + row] ?? "0",
          ),
        ),
      );
      return { type: resultType, comps };
    }

    throw new Error(
      "headless-webgl2: internal: an unindexable type escaped the checker",
    );
  }

  /* ---- binary operators -------------------------------------------------- */

  private emitBinary(expr: Extract<Expr, { node: "binary" }>): Val {
    const resultType = this.t(expr);
    const leftType = this.t(expr.left);
    const rightType = this.t(expr.right);

    switch (expr.op) {
      case "&&":
      case "||": {
        // Both operands are scalar bools. When the right side needed a
        // preamble it evaluates eagerly — a semantic no-op, because subset
        // expressions are side-effect-free; otherwise JS short-circuits
        // exactly as GLSL reads.
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        return {
          type: resultType,
          comps: [`(${left.comps[0]} ${expr.op} ${right.comps[0]})`],
        };
      }
      case "^^": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        return {
          type: resultType,
          comps: [`(${left.comps[0]} !== ${right.comps[0]})`],
        };
      }
      case "==":
      case "!=": {
        const shared = this.sharedType(leftType, rightType);
        const left = this.convert(this.emitExpr(expr.left), shared);
        const right = this.convert(this.emitExpr(expr.right), shared);
        const clauses = left.comps.map(
          (c, i) => `${wrap(c)} === ${wrap(right.comps[i] ?? "0")}`,
        );
        const all = clauses.join(" && ");
        return {
          type: resultType,
          comps: [expr.op === "==" ? `(${all})` : `!(${all})`],
        };
      }
      case "<":
      case ">":
      case "<=":
      case ">=": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        return {
          type: resultType,
          comps: [`(${left.comps[0]} ${expr.op} ${right.comps[0]})`],
        };
      }
      case "%": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        const rightComps =
          right.comps.length === 1 && left.comps.length > 1
            ? Array.from(left.comps, () => right.comps[0] as string)
            : right.comps;
        return {
          type: resultType,
          comps: left.comps.map(
            (c, i) => `(${wrap(c)} % ${wrap(rightComps[i] ?? "0")})`,
          ),
        };
      }
      case "+":
      case "-":
      case "*":
      case "/": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        return this.emitArithmetic(expr.op, left, right, resultType);
      }
    }
  }

  /** Arithmetic on already-emitted values; shared by binary expressions and compound assignment. */
  private emitArithmetic(
    op: "+" | "-" | "*" | "/",
    left: Val,
    right: Val,
    resultType: Type,
  ): Val {
    const leftType = left.type;
    const rightType = right.type;

    // Matrix algebra: `*` is the linear-algebra product; +,-,/ componentwise.
    if (
      op === "*" &&
      leftType.kind === "matrix" &&
      rightType.kind === "matrix"
    ) {
      const size = leftType.size;
      const a = this.save(left);
      const b = this.save(right);
      const comps: string[] = [];
      for (let col = 0; col < size; col += 1) {
        for (let row = 0; row < size; row += 1) {
          const terms: string[] = [];
          for (let k = 0; k < size; k += 1) {
            terms.push(
              `${a.comps[k * size + row]} * ${b.comps[col * size + k]}`,
            );
          }
          comps.push(`(${terms.join(" + ")})`);
        }
      }
      return { type: resultType, comps };
    }
    if (
      op === "*" &&
      leftType.kind === "matrix" &&
      rightType.kind === "vector"
    ) {
      const size = leftType.size;
      const m = this.save(left);
      const v = this.save(right);
      const comps = Array.from(
        { length: size },
        (_, row) =>
          `(${Array.from({ length: size }, (_, k) => `${m.comps[k * size + row]} * ${v.comps[k]}`).join(" + ")})`,
      );
      return { type: resultType, comps };
    }
    if (
      op === "*" &&
      leftType.kind === "vector" &&
      rightType.kind === "matrix"
    ) {
      const size = rightType.size;
      const v = this.save(left);
      const m = this.save(right);
      const comps = Array.from(
        { length: size },
        (_, col) =>
          `(${Array.from({ length: size }, (_, k) => `${v.comps[k]} * ${m.comps[col * size + k]}`).join(" + ")})`,
      );
      return { type: resultType, comps };
    }

    // Everything else is componentwise with scalar broadcast.
    const count = componentCount(resultType);
    const leftComps = broadcast(this.maybeSaveForBroadcast(left, count), count);
    const rightComps = broadcast(
      this.maybeSaveForBroadcast(right, count),
      count,
    );
    const isIntDivision =
      op === "/" &&
      (resultType.kind === "scalar" || resultType.kind === "vector") &&
      resultType.scalar === "int";
    const comps = leftComps.map((c, i) => {
      const raw = `${wrap(c)} ${op} ${wrap(rightComps[i] ?? "0")}`;
      // GLSL int division truncates toward zero; f64 division does not.
      return isIntDivision ? `Math.trunc(${raw})` : `(${raw})`;
    });
    return { type: resultType, comps };
  }

  /** A scalar about to broadcast over n components is saved once, not re-evaluated n times. */
  private maybeSaveForBroadcast(val: Val, count: number): Val {
    if (val.comps.length === 1 && count > 1) return this.save(val);
    return val;
  }

  /* ---- conversions -------------------------------------------------------- */

  /**
   * int → float is the only implicit conversion (GLSL ES 3.00 §4.1.10), and
   * numerically it is the identity here — ints already live in f64 — so a
   * conversion never emits code; this only reshapes the Val's type tag.
   */
  private convert(val: Val, target: Type): Val {
    if (sameType(val.type, target)) return val;
    return { type: target, comps: val.comps };
  }

  private sharedType(a: Type, b: Type): Type {
    if (sameType(a, b)) return a;
    const isFloatish = (t: Type): boolean =>
      (t.kind === "scalar" || t.kind === "vector") && t.scalar === "float";
    return isFloatish(a) ? a : b;
  }

  /* ---- calls ---------------------------------------------------------------- */

  private emitCall(call: Call): Val {
    const resultType = this.t(call);

    // Constructors.
    const constructed = constructorTarget(call.callee);
    if (constructed !== null) return this.emitConstructor(call, resultType);

    // Texture lookups.
    if (call.callee === "texture" || call.callee === "textureLod") {
      return this.emitTexture(call, resultType);
    }

    // User functions.
    if (this.checked.functions.has(call.callee)) {
      return this.emitUserCall(call, resultType);
    }

    return this.emitBuiltin(call, resultType);
  }

  private emitUserCall(call: Call, resultType: Type): Val {
    const fn = this.checked.functions.get(call.callee);
    if (fn === undefined)
      throw new Error(
        "headless-webgl2: internal: user call without a definition",
      );
    const args: string[] = [];
    for (let i = 0; i < call.args.length; i += 1) {
      const arg = call.args[i];
      const param = fn.params[i];
      if (arg === undefined || param === undefined) continue;
      const val = this.convert(this.emitExpr(arg), param.type);
      args.push(...val.comps);
    }
    const invocation = `_f_${call.callee}(${args.join(", ")})`;
    if (resultType.kind === "void") {
      this.line(`${invocation};`);
      return { type: resultType, comps: [] };
    }
    const count = componentCount(resultType);
    if (count === 1) {
      const name = this.temp();
      this.line(`const ${name} = ${invocation};`);
      return { type: resultType, comps: [name] };
    }
    // The scratch return buffer is reused by the next call to the same
    // function, so its components are copied into scalars immediately.
    const scratch = this.temp();
    this.line(`const ${scratch} = ${invocation};`);
    const comps = Array.from({ length: count }, (_, c) => {
      const name = this.temp();
      this.line(`const ${name} = ${scratch}[${c}];`);
      return name;
    });
    return { type: resultType, comps };
  }

  private emitTexture(call: Call, resultType: Type): Val {
    const samplerArg = call.args[0];
    if (samplerArg === undefined || samplerArg.node !== "ident")
      throw new Error(
        "headless-webgl2: internal: texture sampler shape escaped the checker",
      );
    const storage = this.lookup(samplerArg.name);
    if (storage.kind !== "comps")
      throw new Error("headless-webgl2: internal: sampler storage shape");
    const unit = storage.comps[0] ?? "0";

    const uvArg = call.args[1];
    if (uvArg === undefined)
      throw new Error("headless-webgl2: internal: texture without coordinates");
    const uv = this.emitExpr(uvArg);
    const lodArg = call.args[2];
    const lod =
      lodArg === undefined ? "0" : (this.emitExpr(lodArg).comps[0] ?? "0");

    // The sampler function returns a reused 4-component view (stage 3 owns
    // it), so the result is copied into scalars before the next lookup runs.
    const result = this.temp();
    this.line(
      `const ${result} = SMP[${unit} | 0](${uv.comps[0]}, ${uv.comps[1]}, ${lod});`,
    );
    const comps = Array.from({ length: 4 }, (_, c) => {
      const name = this.temp();
      this.line(`const ${name} = ${result}[${c}];`);
      return name;
    });
    return { type: resultType, comps };
  }

  private emitConstructor(call: Call, resultType: Type): Val {
    const argVals = call.args.map((arg) => this.emitExpr(arg));
    const first = argVals[0];
    if (first === undefined)
      throw new Error(
        "headless-webgl2: internal: empty constructor escaped the checker",
      );

    if (resultType.kind === "scalar") {
      return {
        type: resultType,
        comps: [
          convertScalar(
            first.comps[0] ?? "0",
            scalarKindOf(first.type),
            resultType.scalar,
          ),
        ],
      };
    }

    if (resultType.kind === "vector") {
      if (argVals.length === 1 && first.type.kind === "scalar") {
        const saved = this.save(first);
        const comp = convertScalar(
          saved.comps[0] ?? "0",
          first.type.scalar,
          resultType.scalar,
        );
        return {
          type: resultType,
          comps: Array.from({ length: resultType.size }, () => comp),
        };
      }
      const comps: string[] = [];
      for (const val of argVals) {
        const kind = scalarKindOf(val.type);
        for (const comp of val.comps)
          comps.push(convertScalar(comp, kind, resultType.scalar));
      }
      return { type: resultType, comps: comps.slice(0, resultType.size) };
    }

    if (resultType.kind === "matrix") {
      const size = resultType.size;
      if (argVals.length === 1 && first.type.kind === "scalar") {
        const saved = this.save(first);
        const diag = saved.comps[0] ?? "0";
        const comps = Array.from({ length: size * size }, (_, i) =>
          i % size === Math.floor(i / size) ? diag : "0",
        );
        return { type: resultType, comps };
      }
      if (argVals.length === 1 && first.type.kind === "matrix") {
        const from = first.type.size;
        const comps = Array.from({ length: size * size }, (_, i) => {
          const col = Math.floor(i / size);
          const row = i % size;
          if (col < from && row < from)
            return first.comps[col * from + row] ?? "0";
          return col === row ? "1" : "0";
        });
        return { type: resultType, comps };
      }
      const comps: string[] = [];
      for (const val of argVals) {
        const kind = scalarKindOf(val.type);
        for (const comp of val.comps)
          comps.push(convertScalar(comp, kind, "float"));
      }
      return { type: resultType, comps: comps.slice(0, size * size) };
    }

    throw new Error(
      "headless-webgl2: internal: unconstructable type escaped the checker",
    );
  }

  /* ---- builtins --------------------------------------------------------------- */

  private emitBuiltin(call: Call, resultType: Type): Val {
    const name = call.callee;
    const args = call.args.map((arg) => this.emitExpr(arg));
    const a = args[0];
    const b = args[1];
    const c = args[2];
    if (a === undefined)
      throw new Error(
        `headless-webgl2: internal: '${name}' escaped the checker with no arguments`,
      );
    const count = componentCount(resultType);

    /** Componentwise over the first argument. */
    const map1 = (f: (x: string) => string): Val => ({
      type: resultType,
      comps: a.comps.map((x) => f(wrap(x))),
    });
    /** Componentwise over two, broadcasting a scalar second argument. */
    const map2 = (f: (x: string, y: string) => string): Val => {
      if (b === undefined)
        throw new Error(
          `headless-webgl2: internal: '${name}' lost an argument`,
        );
      const ys = broadcast(this.maybeSaveForBroadcast(b, count), count);
      return {
        type: resultType,
        comps: a.comps.map((x, i) => f(wrap(x), wrap(ys[i] ?? "0"))),
      };
    };

    switch (name) {
      case "abs":
        return map1((x) => `Math.abs(${x})`);
      case "sign":
        return map1((x) => `Math.sign(${x})`);
      case "floor":
        return map1((x) => `Math.floor(${x})`);
      case "ceil":
        return map1((x) => `Math.ceil(${x})`);
      case "fract": {
        const saved = this.save(a);
        return {
          type: resultType,
          comps: saved.comps.map((x) => `(${x} - Math.floor(${x}))`),
        };
      }
      case "mod": {
        if (b === undefined) break;
        const x = this.save(a);
        const y = this.save({ type: b.type, comps: broadcast(b, count) });
        return {
          type: resultType,
          comps: x.comps.map(
            (xc, i) =>
              `(${xc} - ${y.comps[i]} * Math.floor(${xc} / ${y.comps[i]}))`,
          ),
        };
      }
      case "min":
        return map2((x, y) => `Math.min(${x}, ${y})`);
      case "max":
        return map2((x, y) => `Math.max(${x}, ${y})`);
      case "clamp": {
        if (b === undefined || c === undefined) break;
        const lo = broadcast(this.maybeSaveForBroadcast(b, count), count);
        const hi = broadcast(this.maybeSaveForBroadcast(c, count), count);
        return {
          type: resultType,
          comps: a.comps.map(
            (x, i) =>
              `Math.min(Math.max(${wrap(x)}, ${wrap(lo[i] ?? "0")}), ${wrap(hi[i] ?? "0")})`,
          ),
        };
      }
      case "mix": {
        if (b === undefined || c === undefined) break;
        const x = this.save(a);
        const y = this.save(b);
        const t = broadcast(
          this.save({
            type: c.type,
            comps: broadcast(this.maybeSaveForBroadcast(c, count), count),
          }),
          count,
        );
        // The x·(1−a) + y·a form, the GLSL definition verbatim: at a=0 and
        // a=1 it reproduces the endpoints exactly, which byte-exactness needs.
        return {
          type: resultType,
          comps: x.comps.map(
            (xc, i) => `(${xc} * (1 - ${t[i]}) + ${y.comps[i]} * ${t[i]})`,
          ),
        };
      }
      case "step": {
        if (b === undefined) break;
        const edges = broadcast(
          this.maybeSaveForBroadcast(a, componentCount(b.type)),
          componentCount(b.type),
        );
        return {
          type: resultType,
          comps: b.comps.map(
            (x, i) => `(${wrap(x)} < ${wrap(edges[i] ?? "0")} ? 0 : 1)`,
          ),
        };
      }
      case "smoothstep": {
        if (b === undefined || c === undefined) break;
        const e0 = broadcast(
          this.save({ type: a.type, comps: a.comps }),
          count,
        );
        const e1 = broadcast(
          this.save({ type: b.type, comps: b.comps }),
          count,
        );
        const x = c.comps;
        const comps = x.map((xc, i) => {
          const t = this.temp();
          this.line(
            `const ${t} = Math.min(Math.max((${wrap(xc)} - ${e0[i]}) / (${e1[i]} - ${e0[i]}), 0), 1);`,
          );
          return `(${t} * ${t} * (3 - 2 * ${t}))`;
        });
        return { type: resultType, comps };
      }
      case "pow":
        return map2((x, y) => `Math.pow(${x}, ${y})`);
      case "exp":
        return map1((x) => `Math.exp(${x})`);
      case "log":
        return map1((x) => `Math.log(${x})`);
      case "exp2":
        return map1((x) => `Math.pow(2, ${x})`);
      case "log2":
        return map1((x) => `Math.log2(${x})`);
      case "sqrt":
        return map1((x) => `Math.sqrt(${x})`);
      case "inversesqrt":
        return map1((x) => `(1 / Math.sqrt(${x}))`);
      case "sin":
        return map1((x) => `Math.sin(${x})`);
      case "cos":
        return map1((x) => `Math.cos(${x})`);
      case "tan":
        return map1((x) => `Math.tan(${x})`);
      case "asin":
        return map1((x) => `Math.asin(${x})`);
      case "acos":
        return map1((x) => `Math.acos(${x})`);
      case "atan": {
        if (b === undefined) return map1((x) => `Math.atan(${x})`);
        return map2((y, x) => `Math.atan2(${y}, ${x})`);
      }
      case "radians":
        return map1((x) => `(${x} * ${numToJs(Math.PI / 180)})`);
      case "degrees":
        return map1((x) => `(${x} * ${numToJs(180 / Math.PI)})`);
      case "length": {
        const v = this.save(a);
        return {
          type: resultType,
          comps: [
            `Math.sqrt(${v.comps.map((x) => `${x} * ${x}`).join(" + ")})`,
          ],
        };
      }
      case "distance": {
        if (b === undefined) break;
        const deltas = a.comps.map((x, i) => {
          const d = this.temp();
          this.line(`const ${d} = ${x} - ${wrap(b.comps[i] ?? "0")};`);
          return d;
        });
        return {
          type: resultType,
          comps: [`Math.sqrt(${deltas.map((d) => `${d} * ${d}`).join(" + ")})`],
        };
      }
      case "dot": {
        if (b === undefined) break;
        return {
          type: resultType,
          comps: [
            `(${a.comps.map((x, i) => `${wrap(x)} * ${wrap(b.comps[i] ?? "0")}`).join(" + ")})`,
          ],
        };
      }
      case "cross": {
        if (b === undefined) break;
        const u = this.save(a);
        const v = this.save(b);
        return {
          type: resultType,
          comps: [
            `(${u.comps[1]} * ${v.comps[2]} - ${u.comps[2]} * ${v.comps[1]})`,
            `(${u.comps[2]} * ${v.comps[0]} - ${u.comps[0]} * ${v.comps[2]})`,
            `(${u.comps[0]} * ${v.comps[1]} - ${u.comps[1]} * ${v.comps[0]})`,
          ],
        };
      }
      case "normalize": {
        // normalize(0) is implementation-defined in GLSL; here it is the zero
        // vector, the deterministic choice the test obligations pin.
        const v = this.save(a);
        const len = this.temp();
        this.line(
          `const ${len} = Math.sqrt(${v.comps.map((x) => `${x} * ${x}`).join(" + ")});`,
        );
        const inv = this.temp();
        this.line(`const ${inv} = ${len} === 0 ? 0 : 1 / ${len};`);
        return {
          type: resultType,
          comps: v.comps.map((x) => `(${x} * ${inv})`),
        };
      }
      case "reflect": {
        if (b === undefined) break;
        const i = this.save(a);
        const n = this.save(b);
        const d = this.temp();
        this.line(
          `const ${d} = ${i.comps.map((x, k) => `${n.comps[k]} * ${x}`).join(" + ")};`,
        );
        return {
          type: resultType,
          comps: i.comps.map((x, k) => `(${x} - 2 * ${d} * ${n.comps[k]})`),
        };
      }
      case "lessThan":
        return map2((x, y) => `(${x} < ${y})`);
      case "lessThanEqual":
        return map2((x, y) => `(${x} <= ${y})`);
      case "greaterThan":
        return map2((x, y) => `(${x} > ${y})`);
      case "greaterThanEqual":
        return map2((x, y) => `(${x} >= ${y})`);
      case "equal":
        return map2((x, y) => `(${x} === ${y})`);
      case "notEqual":
        return map2((x, y) => `(${x} !== ${y})`);
      case "any":
        return {
          type: resultType,
          comps: [`(${a.comps.map(wrap).join(" || ")})`],
        };
      case "all":
        return {
          type: resultType,
          comps: [`(${a.comps.map(wrap).join(" && ")})`],
        };
      case "not":
        return { type: resultType, comps: a.comps.map((x) => `!(${x})`) };
      default:
        break;
    }
    throw new Error(
      `headless-webgl2: internal: the builtin '${name}' resolved but has no emission`,
    );
  }
}

/* ------------------------------------------------------------------------ */
/* Free helpers                                                             */
/* ------------------------------------------------------------------------ */

/** Formats a number as a JS literal; String round-trips f64 exactly, and that exactness is load-bearing. */
function numToJs(value: number): string {
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

/** Parenthesizes a component expression unless it is trivially atomic. */
function wrap(comp: string): string {
  return SIMPLE.test(comp) ? comp : `(${comp})`;
}

/** Broadcasts a 1-component value across n components (the caller saved it first). */
function broadcast(val: Val, count: number): string[] {
  if (val.comps.length === count) return [...val.comps];
  return Array.from({ length: count }, () => val.comps[0] ?? "0");
}

/** `(i <= 0 ? c0 : i === 1 ? c1 : ... : cLast)` — the dynamic-index select for vector/matrix reads. */
function selectChain(index: string, comps: readonly string[]): string {
  let chain = comps[comps.length - 1] ?? "0";
  for (let i = comps.length - 2; i >= 0; i -= 1) {
    chain = `(${index} ${i === 0 ? "<=" : "==="} ${i} ? ${comps[i]} : ${chain})`;
  }
  return chain;
}

/** True for a bool scalar or bool vector — the shapes whose stored 0/1 needs wrapping to a JS boolean. */
function isBoolShaped(type: Type): boolean {
  return (
    (type.kind === "scalar" || type.kind === "vector") && type.scalar === "bool"
  );
}

/** The scalar kind of a scalar/vector type; matrices are float. */
function scalarKindOf(type: Type): "float" | "int" | "bool" {
  if (type.kind === "scalar" || type.kind === "vector") return type.scalar;
  return "float";
}

/** Scalar conversion between kinds, as a JS expression. */
function convertScalar(
  comp: string,
  from: "float" | "int" | "bool",
  to: "float" | "int" | "bool",
): string {
  if (from === to) return comp;
  if (to === "bool") return `(${comp} !== 0)`;
  if (from === "bool") return `(${comp} ? 1 : 0)`;
  if (to === "int") return `Math.trunc(${wrap(comp)})`;
  return comp; // int → float: the identity in f64.
}

/** Mirrors check.ts's constructor table without importing it (module cycle avoidance). */
function constructorTarget(callee: string): true | null {
  switch (callee) {
    case "float":
    case "int":
    case "bool":
    case "vec2":
    case "vec3":
    case "vec4":
    case "ivec2":
    case "ivec3":
    case "ivec4":
    case "bvec2":
    case "bvec3":
    case "bvec4":
    case "mat3":
    case "mat4":
      return true;
    default:
      return null;
  }
}

/** Emits one checked stage into a JS source string; `new Function(src)()` yields the stage function. */
export function emitStage(checked: CheckedShader, layout: StageLayout): string {
  return new Emitter(checked, layout).emit();
}
