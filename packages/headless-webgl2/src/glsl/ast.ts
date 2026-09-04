/**
 * The GLSL ES 3.00 subset's type system and abstract syntax tree. Types are
 * plain discriminated records rather than classes, because the checker and the
 * emitter both pattern-match on them constantly and a record with a `kind`
 * field keeps every match exhaustive under the compiler's eye.
 *
 * The subset's type universe is deliberately small (binding decision 15):
 * float/int/bool scalars, their vectors, the two square float matrices the
 * engines' transforms need, `sampler2D`, and sized arrays — which the checker
 * further restricts to uniforms. Everything else a real GLSL type name could
 * spell (uint, mat2, non-square matrices, the other sampler families) is
 * refused by name at parse time, never mapped onto something almost right.
 */

import { GL } from "../constants";

/* ------------------------------------------------------------------------ */
/* Types                                                                    */
/* ------------------------------------------------------------------------ */

/** The three scalar component kinds the subset carries. */
export type ScalarKind = "float" | "int" | "bool";

export interface ScalarType {
  readonly kind: "scalar";
  readonly scalar: ScalarKind;
}

export interface VectorType {
  readonly kind: "vector";
  readonly scalar: ScalarKind;
  readonly size: 2 | 3 | 4;
}

/** Square float matrices only; mat3 and mat4 are the subset (mat2 is refused by name). */
export interface MatrixType {
  readonly kind: "matrix";
  readonly size: 3 | 4;
}

export interface SamplerType {
  readonly kind: "sampler2D";
}

export interface VoidType {
  readonly kind: "void";
}

/** A sized array; the checker restricts these to uniform declarations. */
export interface ArrayType {
  readonly kind: "array";
  readonly element: ScalarType | VectorType | MatrixType;
  readonly length: number;
}

export type Type =
  | ScalarType
  | VectorType
  | MatrixType
  | SamplerType
  | VoidType
  | ArrayType;

/* Singletons for the common types, so equality-heavy code reads cleanly. */
export const FLOAT: ScalarType = { kind: "scalar", scalar: "float" };
export const INT: ScalarType = { kind: "scalar", scalar: "int" };
export const BOOL: ScalarType = { kind: "scalar", scalar: "bool" };
export const VOID: VoidType = { kind: "void" };
export const SAMPLER_2D: SamplerType = { kind: "sampler2D" };

export function vec(scalar: ScalarKind, size: 2 | 3 | 4): VectorType {
  return { kind: "vector", scalar, size };
}

export function mat(size: 3 | 4): MatrixType {
  return { kind: "matrix", size };
}

/**
 * The scalar components a value of the type occupies, flattened. Matrices are
 * column-major — component index `column * size + row` — matching both the GL
 * uniform upload order and the constructor argument order, so no reordering
 * ever happens between an upload and a shader read.
 */
export function componentCount(type: Type): number {
  switch (type.kind) {
    case "scalar":
      return 1;
    case "vector":
      return type.size;
    case "matrix":
      return type.size * type.size;
    case "sampler2D":
      return 1;
    case "void":
      return 0;
    case "array":
      return componentCount(type.element) * type.length;
  }
}

/** The GLSL spelling of a type, for error messages and info logs. */
export function typeName(type: Type): string {
  switch (type.kind) {
    case "scalar":
      return type.scalar;
    case "vector":
      return `${type.scalar === "float" ? "" : type.scalar === "int" ? "i" : "b"}vec${type.size}`;
    case "matrix":
      return `mat${type.size}`;
    case "sampler2D":
      return "sampler2D";
    case "void":
      return "void";
    case "array":
      return `${typeName(type.element)}[${type.length}]`;
  }
}

export function sameType(a: Type, b: Type): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "scalar":
      return a.scalar === (b as ScalarType).scalar;
    case "vector":
      return (
        a.scalar === (b as VectorType).scalar &&
        a.size === (b as VectorType).size
      );
    case "matrix":
      return a.size === (b as MatrixType).size;
    case "sampler2D":
    case "void":
      return true;
    case "array": {
      const other = b as ArrayType;
      return a.length === other.length && sameType(a.element, other.element);
    }
  }
}

/**
 * The WebGL type enum `getActiveUniform`/`getActiveAttrib` report for a value
 * of this type — the introspection contract validators and boilerplate read.
 */
export function glTypeEnum(type: Type): number {
  switch (type.kind) {
    case "scalar":
      return type.scalar === "float"
        ? GL.FLOAT
        : type.scalar === "int"
          ? GL.INT
          : GL.BOOL;
    case "vector": {
      const base =
        type.scalar === "float"
          ? [GL.FLOAT_VEC2, GL.FLOAT_VEC3, GL.FLOAT_VEC4]
          : type.scalar === "int"
            ? [GL.INT_VEC2, GL.INT_VEC3, GL.INT_VEC4]
            : [GL.BOOL_VEC2, GL.BOOL_VEC3, GL.BOOL_VEC4];
      return base[type.size - 2] ?? GL.FLOAT_VEC4;
    }
    case "matrix":
      return type.size === 3 ? GL.FLOAT_MAT3 : GL.FLOAT_MAT4;
    case "sampler2D":
      return GL.SAMPLER_2D;
    case "array":
      return glTypeEnum(type.element);
    case "void":
      throw new Error("headless-webgl2: internal: void has no GL type enum");
  }
}

/* ------------------------------------------------------------------------ */
/* Compile errors                                                           */
/* ------------------------------------------------------------------------ */

/**
 * A compilation failure. It is an exception internally — the front end
 * fail-fasts on the first error — but it never escapes the compiler: the
 * context catches it and turns it into a browser-shaped info log line
 * (`ERROR: 0:<line>: <message>`), because the documented failure surface is
 * COMPILE_STATUS false with a log, never a throw.
 */
export class CompileError extends Error {
  readonly line: number;

  constructor(line: number, message: string) {
    super(message);
    this.name = "CompileError";
    this.line = line;
  }

  /** The browser-shaped log line consumers see through `getShaderInfoLog`. */
  toLog(): string {
    return `ERROR: 0:${this.line}: ${this.message}`;
  }
}

/* ------------------------------------------------------------------------ */
/* Expressions                                                              */
/* ------------------------------------------------------------------------ */

/** Every node carries the 1-based source line its first token sat on, for error logs. */
export interface NodeBase {
  readonly line: number;
}

export interface NumLit extends NodeBase {
  readonly node: "num";
  readonly value: number;
  /** True for an integer literal (no dot, no exponent, no f suffix); decides int vs float typing. */
  readonly isInt: boolean;
}

export interface BoolLit extends NodeBase {
  readonly node: "bool";
  readonly value: boolean;
}

export interface Ident extends NodeBase {
  readonly node: "ident";
  readonly name: string;
}

export interface Unary extends NodeBase {
  readonly node: "unary";
  readonly op: "-" | "!" | "+";
  readonly operand: Expr;
}

export interface Binary extends NodeBase {
  readonly node: "binary";
  readonly op:
    | "+"
    | "-"
    | "*"
    | "/"
    | "%"
    | "<"
    | ">"
    | "<="
    | ">="
    | "=="
    | "!="
    | "&&"
    | "||"
    | "^^";
  readonly left: Expr;
  readonly right: Expr;
}

export interface Ternary extends NodeBase {
  readonly node: "ternary";
  readonly cond: Expr;
  readonly then: Expr;
  readonly else: Expr;
}

/** A call: constructor (`vec3(...)`), builtin (`mix(...)`), or user function. */
export interface Call extends NodeBase {
  readonly node: "call";
  readonly callee: string;
  readonly args: readonly Expr[];
}

export interface IndexExpr extends NodeBase {
  readonly node: "index";
  readonly target: Expr;
  readonly index: Expr;
}

/** `.xyz` — with no structs in the subset, every member access is a swizzle. */
export interface Swizzle extends NodeBase {
  readonly node: "swizzle";
  readonly target: Expr;
  readonly components: string;
}

export type Expr =
  | NumLit
  | BoolLit
  | Ident
  | Unary
  | Binary
  | Ternary
  | Call
  | IndexExpr
  | Swizzle;

/* ------------------------------------------------------------------------ */
/* Statements                                                               */
/* ------------------------------------------------------------------------ */

export interface Declarator {
  readonly name: string;
  readonly init: Expr | null;
  readonly line: number;
}

export interface VarDeclStmt extends NodeBase {
  readonly node: "var";
  readonly type: Type;
  readonly isConst: boolean;
  readonly declarators: readonly Declarator[];
}

export interface AssignStmt extends NodeBase {
  readonly node: "assign";
  readonly op: "=" | "+=" | "-=" | "*=" | "/=";
  readonly lhs: Expr;
  readonly rhs: Expr;
}

export interface IfStmt extends NodeBase {
  readonly node: "if";
  readonly cond: Expr;
  readonly then: BlockStmt;
  readonly else: BlockStmt | IfStmt | null;
}

/** The `for` update forms the subset admits: `i++`, `i--`, `i += k`, `i -= k`. */
export interface ForUpdate {
  readonly name: string;
  readonly op: "++" | "--" | "+=" | "-=";
  readonly amount: Expr | null;
  readonly line: number;
}

export interface ForStmt extends NodeBase {
  readonly node: "for";
  readonly init: VarDeclStmt;
  readonly cond: Binary;
  readonly update: ForUpdate;
  readonly body: BlockStmt;
}

export interface ReturnStmt extends NodeBase {
  readonly node: "return";
  readonly value: Expr | null;
}

export interface DiscardStmt extends NodeBase {
  readonly node: "discard";
}

/** `i++;` / `++i;` as a statement — the only place inc/dec exists outside a for header. */
export interface IncDecStmt extends NodeBase {
  readonly node: "incdec";
  readonly name: string;
  readonly op: "++" | "--";
}

/** A bare call as a statement (a void helper, typically). */
export interface CallStmt extends NodeBase {
  readonly node: "callstmt";
  readonly call: Call;
}

export interface BlockStmt extends NodeBase {
  readonly node: "block";
  readonly statements: readonly Stmt[];
}

export type Stmt =
  | VarDeclStmt
  | AssignStmt
  | IfStmt
  | ForStmt
  | ReturnStmt
  | DiscardStmt
  | IncDecStmt
  | CallStmt
  | BlockStmt;

/* ------------------------------------------------------------------------ */
/* Declarations                                                             */
/* ------------------------------------------------------------------------ */

export type GlobalQualifier = "in" | "out" | "uniform" | "const";

export interface GlobalDecl extends NodeBase {
  readonly node: "global";
  readonly qualifier: GlobalQualifier;
  /** The element type as parsed; `arraySize` (checker-resolved) makes it an array. */
  readonly type: Type;
  readonly name: string;
  /**
   * The size expression of `name[N]`, or null for a non-array. It stays an
   * expression until the checker, because a size may name a const int global
   * (`uniform vec4 u_lights[MAX_LIGHTS]`) and consts resolve at check time.
   */
  readonly arraySize: Expr | null;
  /** From `layout(location = N)`; meaningful on vertex `in`s, ignored elsewhere. */
  readonly layoutLocation: number | null;
  readonly init: Expr | null;
}

export interface ParamDecl {
  readonly type: Type;
  readonly name: string;
  readonly line: number;
}

export interface FunctionDecl extends NodeBase {
  readonly node: "function";
  readonly returnType: Type;
  readonly name: string;
  readonly params: readonly ParamDecl[];
  readonly body: BlockStmt;
}

export interface ShaderAst {
  readonly globals: readonly GlobalDecl[];
  readonly functions: readonly FunctionDecl[];
}
