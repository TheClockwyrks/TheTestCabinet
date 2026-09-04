/**
 * The GLSL ES 3.00 subset parser: a hand-written recursive descent over the
 * lexer's tokens, producing the AST of `ast.ts`. Two rules shape it:
 *
 * 1. **Refusals name the construct.** Every keyword and form GLSL has but the
 *    subset excludes — `while`, `struct`, `switch`, `uint`, `mat2`,
 *    out-parameters, the preprocessor — is recognized and refused with a
 *    message naming it and, where one exists, the inside-subset alternative.
 *    "Unexpected token" is reserved for genuinely malformed source.
 * 2. **Structure here, meaning in the checker.** The parser accepts anything
 *    shape-legal (assigning to a call, indexing a float) and leaves typing,
 *    l-value legality, and const resolution to `check.ts`, because those
 *    errors deserve type-aware messages the parser cannot write.
 */

import {
  CompileError,
  BOOL,
  FLOAT,
  INT,
  SAMPLER_2D,
  VOID,
  mat,
  vec,
} from "./ast";
import type {
  AssignStmt,
  BlockStmt,
  Call,
  CallStmt,
  Declarator,
  DiscardStmt,
  Expr,
  ForStmt,
  ForUpdate,
  FunctionDecl,
  GlobalDecl,
  GlobalQualifier,
  IfStmt,
  IncDecStmt,
  ParamDecl,
  ReturnStmt,
  ShaderAst,
  Stmt,
  Type,
  VarDeclStmt,
} from "./ast";
import { tokenize, type Token } from "./lex";

/** Type keywords the subset implements, by spelling. */
const TYPES = new Map<string, Type>([
  ["void", VOID],
  ["float", FLOAT],
  ["int", INT],
  ["bool", BOOL],
  ["vec2", vec("float", 2)],
  ["vec3", vec("float", 3)],
  ["vec4", vec("float", 4)],
  ["ivec2", vec("int", 2)],
  ["ivec3", vec("int", 3)],
  ["ivec4", vec("int", 4)],
  ["bvec2", vec("bool", 2)],
  ["bvec3", vec("bool", 3)],
  ["bvec4", vec("bool", 4)],
  ["mat3", mat(3)],
  ["mat4", mat(4)],
  ["sampler2D", SAMPLER_2D],
]);

/** Type keywords GLSL has but the subset refuses, each with its named reason. */
const EXCLUDED_TYPES = new Map<string, string>([
  ["uint", "unsigned integer types are outside the subset; use int"],
  ["uvec2", "unsigned integer types are outside the subset; use ivec2"],
  ["uvec3", "unsigned integer types are outside the subset; use ivec3"],
  ["uvec4", "unsigned integer types are outside the subset; use ivec4"],
  ["mat2", "'mat2' is outside the subset; only the square mat3 and mat4 exist"],
  [
    "mat2x2",
    "'mat2x2' is outside the subset; only the square mat3 and mat4 exist",
  ],
  ["mat2x3", "non-square matrix types are outside the subset"],
  ["mat2x4", "non-square matrix types are outside the subset"],
  ["mat3x2", "non-square matrix types are outside the subset"],
  [
    "mat3x3",
    "write 'mat3x3' as mat3; only the square mat3 and mat4 exist in the subset",
  ],
  ["mat3x4", "non-square matrix types are outside the subset"],
  ["mat4x2", "non-square matrix types are outside the subset"],
  ["mat4x3", "non-square matrix types are outside the subset"],
  [
    "mat4x4",
    "write 'mat4x4' as mat4; only the square mat3 and mat4 exist in the subset",
  ],
  ["sampler3D", "'sampler3D' is outside the subset; only sampler2D exists"],
  ["samplerCube", "'samplerCube' is outside the subset; only sampler2D exists"],
  [
    "sampler2DArray",
    "'sampler2DArray' is outside the subset; only sampler2D exists",
  ],
  [
    "sampler2DShadow",
    "'sampler2DShadow' is outside the subset; only sampler2D exists",
  ],
  [
    "samplerCubeShadow",
    "'samplerCubeShadow' is outside the subset; only sampler2D exists",
  ],
  [
    "sampler2DArrayShadow",
    "'sampler2DArrayShadow' is outside the subset; only sampler2D exists",
  ],
  [
    "isampler2D",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "isampler3D",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "isamplerCube",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "isampler2DArray",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "usampler2D",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "usampler3D",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "usamplerCube",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
  [
    "usampler2DArray",
    "integer sampler types are outside the subset; only sampler2D exists",
  ],
]);

/** Statement keywords GLSL has but the subset refuses, each with its named reason. */
const EXCLUDED_STATEMENTS = new Map<string, string>([
  [
    "while",
    "the 'while' loop is outside the subset; use a for-loop with a constant or uniform-int bound",
  ],
  [
    "do",
    "the 'do-while' loop is outside the subset; use a for-loop with a constant or uniform-int bound",
  ],
  ["switch", "'switch' is outside the subset; use if/else chains"],
  ["case", "'case' is outside the subset; use if/else chains"],
  ["default", "'default' is outside the subset; use if/else chains"],
  [
    "break",
    "'break' is outside the subset; bound the loop or guard the body with if",
  ],
  ["continue", "'continue' is outside the subset; guard the loop body with if"],
  [
    "struct",
    "'struct' is outside the subset; use parallel scalar/vector declarations (lights travel as parallel uniform arrays)",
  ],
]);

const PRECISIONS = new Set(["lowp", "mediump", "highp"]);

class Parser {
  private readonly tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  /* ---- token plumbing ------------------------------------------------ */

  private peek(ahead = 0): Token {
    return this.tokens[
      Math.min(this.pos + ahead, this.tokens.length - 1)
    ] as Token;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "eof") this.pos += 1;
    return token;
  }

  private at(text: string): boolean {
    const token = this.peek();
    return (
      (token.kind === "punct" || token.kind === "keyword") &&
      token.text === text
    );
  }

  private eat(text: string): boolean {
    if (this.at(text)) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private expect(text: string, context: string): Token {
    const token = this.peek();
    if (!this.at(text)) {
      throw new CompileError(
        token.line,
        `expected '${text}' ${context}, got '${token.text}'`,
      );
    }
    return this.next();
  }

  private expectIdent(context: string): Token {
    const token = this.peek();
    if (token.kind !== "ident") {
      throw new CompileError(
        token.line,
        `expected an identifier ${context}, got '${token.text}'`,
      );
    }
    return this.next();
  }

  /* ---- types --------------------------------------------------------- */

  /** Parses a type keyword, refusing excluded type spellings by name; null if not at a type. */
  private tryType(): Type | null {
    const token = this.peek();
    if (token.kind !== "keyword") return null;
    const excluded = EXCLUDED_TYPES.get(token.text);
    if (excluded !== undefined) throw new CompileError(token.line, excluded);
    const type = TYPES.get(token.text);
    if (type === undefined) return null;
    this.pos += 1;
    return type;
  }

  private expectType(context: string): Type {
    const type = this.tryType();
    if (type === null) {
      const token = this.peek();
      throw new CompileError(
        token.line,
        `expected a type ${context}, got '${token.text}'`,
      );
    }
    return type;
  }

  /** Consumes an optional precision qualifier; precision is parsed and ignored (all math is f64). */
  private skipPrecision(): void {
    const token = this.peek();
    if (token.kind === "keyword" && PRECISIONS.has(token.text)) this.pos += 1;
  }

  /* ---- top level ----------------------------------------------------- */

  parseShader(): ShaderAst {
    const globals: GlobalDecl[] = [];
    const functions: FunctionDecl[] = [];
    while (this.peek().kind !== "eof") {
      const token = this.peek();

      // `precision highp float;` — parsed and dropped; every value is f64.
      if (token.kind === "keyword" && token.text === "precision") {
        this.next();
        this.skipPrecision();
        this.expectType("in a precision declaration");
        this.expect(";", "after a precision declaration");
        continue;
      }

      const item = this.parseTopLevel();
      if (item.node === "global") globals.push(item);
      else functions.push(item);
    }
    return { globals, functions };
  }

  private parseTopLevel(): GlobalDecl | FunctionDecl {
    const startLine = this.peek().line;

    // layout(location = N), only on in/out declarations.
    let layoutLocation: number | null = null;
    if (this.eat("layout")) {
      this.expect("(", "after 'layout'");
      this.expect(
        "location",
        "in a layout qualifier (only 'location' is inside the subset)",
      );
      this.expect("=", "in a layout qualifier");
      const num = this.peek();
      if (num.kind !== "int")
        throw new CompileError(
          num.line,
          `expected an integer location in the layout qualifier, got '${num.text}'`,
        );
      this.next();
      layoutLocation = num.value;
      this.expect(")", "after the layout qualifier");
    }

    // Interpolation and other pre-qualifiers: smooth is the default and
    // allowed; flat/centroid/invariant change interpolation semantics the
    // rasterizer does not implement, so they are refused by name.
    this.eat("smooth");
    const pre = this.peek();
    if (pre.kind === "keyword" && pre.text === "flat") {
      throw new CompileError(
        pre.line,
        "the 'flat' interpolation qualifier is outside the subset (all varyings interpolate smoothly, so use float-based varyings)",
      );
    }
    if (
      pre.kind === "keyword" &&
      (pre.text === "centroid" || pre.text === "invariant")
    ) {
      throw new CompileError(
        pre.line,
        `the '${pre.text}' qualifier is outside the subset`,
      );
    }

    // Storage qualifier.
    let qualifier: GlobalQualifier | null = null;
    if (this.eat("in")) qualifier = "in";
    else if (this.eat("out")) qualifier = "out";
    else if (this.eat("uniform")) qualifier = "uniform";
    else if (this.eat("const")) qualifier = "const";

    this.skipPrecision();
    const refusedStmt = this.peek();
    if (refusedStmt.kind === "keyword") {
      const reason = EXCLUDED_STATEMENTS.get(refusedStmt.text);
      if (reason !== undefined)
        throw new CompileError(refusedStmt.line, reason);
    }
    const type = this.expectType("in a declaration");
    const nameToken = this.expectIdent("in a declaration");

    // A function definition: type name ( ... ) { ... }. Only valid unqualified.
    if (this.at("(")) {
      if (qualifier !== null || layoutLocation !== null) {
        throw new CompileError(
          nameToken.line,
          `a function definition cannot carry a storage or layout qualifier`,
        );
      }
      return this.parseFunction(type, nameToken);
    }

    if (qualifier === null) {
      throw new CompileError(
        nameToken.line,
        `the global variable '${nameToken.text}' has no qualifier; unqualified mutable globals are outside the subset — pass values through function parameters, or declare it const`,
      );
    }

    // Array suffix; the size expression resolves in the checker (const globals).
    let arraySize: Expr | null = null;
    if (this.eat("[")) {
      arraySize = this.parseExpression();
      this.expect("]", "after the array size");
    }

    let init: Expr | null = null;
    if (this.eat("=")) init = this.parseExpression();
    this.expect(";", "after the declaration");
    return {
      node: "global",
      line: startLine,
      qualifier,
      type,
      name: nameToken.text,
      arraySize,
      layoutLocation,
      init,
    };
  }

  private parseFunction(returnType: Type, nameToken: Token): FunctionDecl {
    this.expect("(", "after the function name");
    const params: ParamDecl[] = [];
    if (!this.at(")")) {
      // `void` as the whole parameter list.
      if (this.at("void") && this.peek(1).text === ")") {
        this.next();
      } else {
        do {
          const qual = this.peek();
          if (
            qual.kind === "keyword" &&
            (qual.text === "out" || qual.text === "inout")
          ) {
            throw new CompileError(
              qual.line,
              `'${qual.text}' function parameters are outside the subset; parameters pass by value — return the result instead`,
            );
          }
          this.eat("in"); // `in` is the value-parameter default; accepted and meaningless.
          this.eat("const");
          this.skipPrecision();
          const type = this.expectType("in a function parameter");
          const param = this.expectIdent("in a function parameter");
          if (this.at("[")) {
            throw new CompileError(
              param.line,
              "array function parameters are outside the subset; only uniform declarations may be arrays",
            );
          }
          params.push({ type, name: param.text, line: param.line });
        } while (this.eat(","));
      }
    }
    this.expect(")", "after the parameter list");
    const semicolon = this.peek();
    if (semicolon.text === ";") {
      throw new CompileError(
        semicolon.line,
        `the function prototype for '${nameToken.text}' is outside the subset; define helper functions before their first call instead`,
      );
    }
    const body = this.parseBlock();
    return {
      node: "function",
      line: nameToken.line,
      returnType,
      name: nameToken.text,
      params,
      body,
    };
  }

  /* ---- statements ---------------------------------------------------- */

  private parseBlock(): BlockStmt {
    const open = this.expect("{", "to open a block");
    const statements: Stmt[] = [];
    while (!this.at("}")) {
      if (this.peek().kind === "eof")
        throw new CompileError(open.line, "unterminated block: missing '}'");
      statements.push(this.parseStatement());
    }
    this.expect("}", "to close the block");
    return { node: "block", line: open.line, statements };
  }

  private parseStatement(): Stmt {
    const token = this.peek();

    if (token.kind === "keyword") {
      const reason = EXCLUDED_STATEMENTS.get(token.text);
      if (reason !== undefined) throw new CompileError(token.line, reason);
    }

    if (this.at("{")) return this.parseBlock();
    if (this.at("if")) return this.parseIf();
    if (this.at("for")) return this.parseFor();

    if (this.eat("return")) {
      const value = this.at(";") ? null : this.parseExpression();
      this.expect(";", "after 'return'");
      return { node: "return", line: token.line, value } satisfies ReturnStmt;
    }

    if (this.eat("discard")) {
      this.expect(";", "after 'discard'");
      return { node: "discard", line: token.line } satisfies DiscardStmt;
    }

    // Prefix increment/decrement statement: `++i;`.
    if (this.at("++") || this.at("--")) {
      const op = this.next().text as "++" | "--";
      const name = this.expectIdent(`after '${op}'`);
      this.expect(";", "after the increment/decrement");
      return {
        node: "incdec",
        line: token.line,
        name: name.text,
        op,
      } satisfies IncDecStmt;
    }

    // Local declaration: starts with `const`, a precision qualifier, or a type keyword.
    const startsType = (t: Token): boolean =>
      t.kind === "keyword" &&
      (TYPES.has(t.text) || EXCLUDED_TYPES.has(t.text)) &&
      t.text !== "void";
    if (
      this.at("const") ||
      startsType(token) ||
      (token.kind === "keyword" &&
        PRECISIONS.has(token.text) &&
        startsType(this.peek(1)))
    ) {
      return this.parseLocalDecl();
    }
    if (this.at("void")) {
      throw new CompileError(
        token.line,
        "a nested function definition is outside the subset; define helper functions at the top level",
      );
    }

    // Everything else: an expression followed by an assignment operator, a
    // postfix increment/decrement, or nothing (a bare call).
    const expr = this.parseExpression();
    const after = this.peek();
    if (
      after.text === "=" ||
      after.text === "+=" ||
      after.text === "-=" ||
      after.text === "*=" ||
      after.text === "/="
    ) {
      const op = this.next().text as AssignStmt["op"];
      const rhs = this.parseExpression();
      this.expect(";", "after the assignment");
      return {
        node: "assign",
        line: token.line,
        op,
        lhs: expr,
        rhs,
      } satisfies AssignStmt;
    }
    if (after.text === "++" || after.text === "--") {
      if (expr.node !== "ident")
        throw new CompileError(
          after.line,
          `'${after.text}' applies only to a plain int variable`,
        );
      const op = this.next().text as "++" | "--";
      this.expect(";", "after the increment/decrement");
      return {
        node: "incdec",
        line: token.line,
        name: expr.name,
        op,
      } satisfies IncDecStmt;
    }
    if (expr.node === "call") {
      this.expect(";", "after the call");
      return {
        node: "callstmt",
        line: token.line,
        call: expr,
      } satisfies CallStmt;
    }
    throw new CompileError(
      after.line,
      `expected an assignment or a call statement, got '${after.text}'`,
    );
  }

  private parseLocalDecl(): VarDeclStmt {
    const startLine = this.peek().line;
    const isConst = this.eat("const");
    this.skipPrecision();
    const type = this.expectType("in a declaration");
    const declarators: Declarator[] = [];
    do {
      const name = this.expectIdent("in a declaration");
      if (this.at("[")) {
        throw new CompileError(
          name.line,
          `the local array '${name.text}' is outside the subset; only uniform declarations may be arrays`,
        );
      }
      let init: Expr | null = null;
      if (this.eat("=")) init = this.parseExpression();
      declarators.push({ name: name.text, init, line: name.line });
    } while (this.eat(","));
    this.expect(";", "after the declaration");
    return { node: "var", line: startLine, type, isConst, declarators };
  }

  private parseIf(): IfStmt {
    const start = this.expect("if", "at an if statement");
    this.expect("(", "after 'if'");
    const cond = this.parseExpression();
    this.expect(")", "after the if condition");
    const then = this.parseBranchBody();
    let elseBranch: BlockStmt | IfStmt | null = null;
    if (this.eat("else")) {
      elseBranch = this.at("if") ? this.parseIf() : this.parseBranchBody();
    }
    return { node: "if", line: start.line, cond, then, else: elseBranch };
  }

  /** An if/else branch: a block, or a single statement wrapped into one so the emitter has one shape. */
  private parseBranchBody(): BlockStmt {
    if (this.at("{")) return this.parseBlock();
    const stmt = this.parseStatement();
    return { node: "block", line: stmt.line, statements: [stmt] };
  }

  /**
   * The bounded for-loop, the subset's only loop. The shape is enforced at
   * parse: `for (int i = <expr>; i <cmp> <expr>; <update on i>)` — the
   * checker adds the const/uniform bound rule and direction consistency,
   * which together are what make every loop provably terminating.
   */
  private parseFor(): ForStmt {
    const start = this.expect("for", "at a for statement");
    this.expect("(", "after 'for'");

    const initToken = this.peek();
    if (!this.at("int")) {
      throw new CompileError(
        initToken.line,
        "the for-loop must declare its own int counter: for (int i = ...; ...; ...)",
      );
    }
    const init = this.parseLocalDecl();
    if (init.declarators.length !== 1) {
      throw new CompileError(
        init.line,
        "the for-loop counter must be a single declaration",
      );
    }
    const counter = init.declarators[0];
    if (counter === undefined || counter.init === null) {
      throw new CompileError(
        init.line,
        "the for-loop counter needs an initializer: for (int i = 0; ...)",
      );
    }

    const cond = this.parseExpression();
    if (
      cond.node !== "binary" ||
      (cond.op !== "<" &&
        cond.op !== "<=" &&
        cond.op !== ">" &&
        cond.op !== ">=")
    ) {
      throw new CompileError(
        cond.line,
        "the for-loop condition must compare the counter with <, <=, >, or >= against a constant or uniform int bound",
      );
    }
    this.expect(";", "after the for-loop condition");

    const update = this.parseForUpdate(counter.name);
    this.expect(")", "after the for-loop header");
    const body = this.parseBranchBody();
    return { node: "for", line: start.line, init, cond, update, body };
  }

  private parseForUpdate(counterName: string): ForUpdate {
    const token = this.peek();
    if (this.at("++") || this.at("--")) {
      const op = this.next().text as "++" | "--";
      const name = this.expectIdent(`after '${op}'`);
      this.requireCounter(name.text, counterName, name.line);
      return { name: name.text, op, amount: null, line: token.line };
    }
    const name = this.expectIdent("in the for-loop update");
    this.requireCounter(name.text, counterName, name.line);
    const opToken = this.peek();
    if (opToken.text === "++" || opToken.text === "--") {
      this.next();
      return {
        name: name.text,
        op: opToken.text as "++" | "--",
        amount: null,
        line: token.line,
      };
    }
    if (opToken.text === "+=" || opToken.text === "-=") {
      this.next();
      const amount = this.parseExpression();
      return {
        name: name.text,
        op: opToken.text as "+=" | "-=",
        amount,
        line: token.line,
      };
    }
    throw new CompileError(
      opToken.line,
      `the for-loop update must be ++, --, +=, or -= on the counter, got '${opToken.text}'`,
    );
  }

  private requireCounter(
    name: string,
    counterName: string,
    line: number,
  ): void {
    if (name !== counterName) {
      throw new CompileError(
        line,
        `the for-loop update must step the loop's own counter '${counterName}', got '${name}'`,
      );
    }
  }

  /* ---- expressions --------------------------------------------------- */

  parseExpression(): Expr {
    return this.parseTernary();
  }

  private parseTernary(): Expr {
    const cond = this.parseBinary(0);
    if (!this.at("?")) return cond;
    const q = this.next();
    const then = this.parseExpression();
    this.expect(":", "in the conditional expression");
    const elseExpr = this.parseTernary();
    return { node: "ternary", line: q.line, cond, then, else: elseExpr };
  }

  /** Precedence-climbing levels, loosest first. */
  private static readonly BINARY_LEVELS: readonly (readonly string[])[] = [
    ["||"],
    ["^^"],
    ["&&"],
    ["==", "!="],
    ["<", ">", "<=", ">="],
    ["+", "-"],
    ["*", "/", "%"],
  ];

  private parseBinary(level: number): Expr {
    const ops = Parser.BINARY_LEVELS[level];
    if (ops === undefined) return this.parseUnary();
    let left = this.parseBinary(level + 1);
    for (;;) {
      const token = this.peek();
      if (token.kind !== "punct" || !ops.includes(token.text)) return left;
      this.next();
      const right = this.parseBinary(level + 1);
      left = {
        node: "binary",
        line: token.line,
        op: token.text as never,
        left,
        right,
      };
    }
  }

  private parseUnary(): Expr {
    const token = this.peek();
    if (token.text === "++" || token.text === "--") {
      throw new CompileError(
        token.line,
        `'${token.text}' inside an expression is outside the subset; increment/decrement is a statement (or the for-loop update)`,
      );
    }
    if (token.text === "-" || token.text === "!" || token.text === "+") {
      this.next();
      const operand = this.parseUnary();
      return {
        node: "unary",
        line: token.line,
        op: token.text as "-" | "!" | "+",
        operand,
      };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let expr = this.parsePrimary();
    for (;;) {
      const token = this.peek();
      if (token.text === "[") {
        this.next();
        const index = this.parseExpression();
        this.expect("]", "after the index");
        expr = { node: "index", line: token.line, target: expr, index };
        continue;
      }
      if (token.text === ".") {
        this.next();
        const member = this.expectIdent("after '.'");
        expr = {
          node: "swizzle",
          line: member.line,
          target: expr,
          components: member.text,
        };
        continue;
      }
      if (token.text === "++" || token.text === "--") {
        // `i++;` — the statement form — leaves the operator for the statement
        // parser. Anything else (`i++ + 1`) is increment-in-expression,
        // refused by name here so the log can say why.
        if (this.peek(1).text === ";" && expr.node === "ident") return expr;
        throw new CompileError(
          token.line,
          `'${token.text}' inside an expression is outside the subset; increment/decrement is a statement (or the for-loop update)`,
        );
      }
      return expr;
    }
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    if (token.kind === "int" || token.kind === "float") {
      this.next();
      return {
        node: "num",
        line: token.line,
        value: token.value,
        isInt: token.kind === "int",
      };
    }
    if (
      token.kind === "keyword" &&
      (token.text === "true" || token.text === "false")
    ) {
      this.next();
      return { node: "bool", line: token.line, value: token.text === "true" };
    }
    if (token.text === "(") {
      this.next();
      const inner = this.parseExpression();
      this.expect(")", "to close the parenthesis");
      return inner;
    }

    // A constructor: a type keyword used as a callee. Excluded type spellings
    // refuse by name here too (`mat2(...)` must not read as "unexpected token").
    if (token.kind === "keyword") {
      const excluded = EXCLUDED_TYPES.get(token.text);
      if (excluded !== undefined) throw new CompileError(token.line, excluded);
      if (
        TYPES.has(token.text) &&
        token.text !== "void" &&
        token.text !== "sampler2D"
      ) {
        this.next();
        return this.parseCall(token.text, token.line);
      }
    }

    if (token.kind === "ident") {
      this.next();
      if (this.at("(")) return this.parseCall(token.text, token.line);
      return { node: "ident", line: token.line, name: token.text };
    }

    throw new CompileError(
      token.line,
      `expected an expression, got '${token.text}'`,
    );
  }

  private parseCall(callee: string, line: number): Call {
    this.expect("(", `after '${callee}'`);
    const args: Expr[] = [];
    if (!this.at(")")) {
      do {
        args.push(this.parseExpression());
      } while (this.eat(","));
    }
    this.expect(")", `to close the call to '${callee}'`);
    return { node: "call", line, callee, args };
  }
}

/** Parses a whole shader source (with its `#version 300 es` line) into an AST. Throws CompileError. */
export function parse(source: string): ShaderAst {
  return new Parser(tokenize(source)).parseShader();
}
