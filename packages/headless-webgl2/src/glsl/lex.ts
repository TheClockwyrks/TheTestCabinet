/**
 * The GLSL ES 3.00 subset lexer. It tokenizes the whole language the parser
 * understands plus the constructs the subset refuses — `while`, `struct`,
 * bitwise operators — because a refusal must be able to name what it saw:
 * "unexpected character" would hide the real reason from the info log, and
 * position-carrying named refusals are this package's compile-error contract.
 *
 * The `#version 300 es` line is handled here, before tokenizing: it is the
 * only preprocessor directive the subset admits, it must come first (per the
 * GLSL specification), and it is blanked in place rather than sliced out so
 * every later token keeps its true source line for error logs.
 */

import { CompileError } from "./ast";

export type TokenKind = "keyword" | "ident" | "int" | "float" | "punct" | "eof";

export interface Token {
  readonly kind: TokenKind;
  /** The spelling: the identifier/keyword text, the punctuator, or the literal's source text. */
  readonly text: string;
  /** The numeric value of an int/float literal; 0 otherwise. */
  readonly value: number;
  readonly line: number;
}

/**
 * The keywords the parser dispatches on. Type names are included so the token
 * stream distinguishes `vec3(` (constructor) from an identifier call cheaply,
 * and the refused keywords (`while`, `struct`, `switch`, …) are included so
 * the parser can refuse them by name.
 */
const KEYWORDS = new Set([
  "void", "float", "int", "bool", "true", "false",
  "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4",
  "mat3", "mat4", "sampler2D",
  "in", "out", "inout", "uniform", "const", "layout", "location",
  "precision", "highp", "mediump", "lowp",
  "if", "else", "for", "return", "discard",
  "smooth", "flat", "centroid", "invariant",
  // Refused constructs, kept as keywords so refusals can name them.
  "while", "do", "switch", "case", "default", "break", "continue", "struct",
  "uint", "uvec2", "uvec3", "uvec4",
  "mat2", "mat2x2", "mat2x3", "mat2x4", "mat3x2", "mat3x3", "mat3x4", "mat4x2", "mat4x3", "mat4x4",
  "sampler3D", "samplerCube", "sampler2DArray", "sampler2DShadow", "samplerCubeShadow", "sampler2DArrayShadow",
  "isampler2D", "isampler3D", "isamplerCube", "isampler2DArray",
  "usampler2D", "usampler3D", "usamplerCube", "usampler2DArray",
]);

/** Multi-character punctuators, longest first so `<=` never lexes as `<` `=`. */
const PUNCTUATORS = [
  "<<=", ">>=",
  "==", "!=", "<=", ">=", "&&", "||", "^^", "++", "--", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<", ">>",
  "+", "-", "*", "/", "%", "<", ">", "=", "!", "?", ":", ";", ",", ".", "(", ")", "[", "]", "{", "}", "&", "|", "^", "~",
];

/** The punctuators that spell bitwise operations, refused by name (subset excludes bitwise ops). */
const BITWISE = new Set(["&", "|", "^", "~", "<<", ">>", "&=", "|=", "^=", "<<=", ">>="]);

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isIdentStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isIdentPart(c: string): boolean {
  return isIdentStart(c) || isDigit(c);
}

/**
 * Verifies and blanks the `#version 300 es` line, refusing any other `#`
 * directive by name — the subset has no preprocessor, and a shader leaning on
 * `#define` must hear that rather than watch its macros go unexpanded.
 * Returns the source with the version line replaced by spaces (line numbers
 * preserved).
 */
function stripVersion(source: string): string {
  const lines = source.split("\n");
  let versionLine = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    if (/^#\s*version\s+300\s+es\s*$/.test(trimmed)) {
      versionLine = i;
      break;
    }
    throw new CompileError(i + 1, "the shader must begin with '#version 300 es' before any other content");
  }
  if (versionLine === -1) {
    throw new CompileError(1, "the shader must begin with '#version 300 es' before any other content");
  }
  const out = [...lines];
  out[versionLine] = "";
  return out.join("\n");
}

/** Tokenizes a whole shader source, `#version` line included. Throws CompileError, never returns bad tokens. */
export function tokenize(source: string): Token[] {
  const text = stripVersion(source);
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;

  const length = text.length;
  while (pos < length) {
    const c = text[pos] ?? "";

    if (c === "\n") {
      line += 1;
      pos += 1;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      pos += 1;
      continue;
    }

    // Comments: both forms, with line counting through block comments.
    if (c === "/" && text[pos + 1] === "/") {
      while (pos < length && text[pos] !== "\n") pos += 1;
      continue;
    }
    if (c === "/" && text[pos + 1] === "*") {
      pos += 2;
      while (pos < length && !(text[pos] === "*" && text[pos + 1] === "/")) {
        if (text[pos] === "\n") line += 1;
        pos += 1;
      }
      if (pos >= length) throw new CompileError(line, "unterminated block comment");
      pos += 2;
      continue;
    }

    if (c === "#") {
      throw new CompileError(line, "preprocessor directives other than '#version 300 es' are outside the subset (no #define, #ifdef, #include, ...)");
    }

    if (isIdentStart(c)) {
      const start = pos;
      while (pos < length && isIdentPart(text[pos] ?? "")) pos += 1;
      const word = text.slice(start, pos);
      tokens.push({ kind: KEYWORDS.has(word) ? "keyword" : "ident", text: word, value: 0, line });
      continue;
    }

    if (isDigit(c) || (c === "." && isDigit(text[pos + 1] ?? ""))) {
      const start = pos;
      let isFloat = false;
      // Hex and octal integer forms per GLSL; the common decimal path falls through.
      if (c === "0" && (text[pos + 1] === "x" || text[pos + 1] === "X")) {
        pos += 2;
        const hexStart = pos;
        while (pos < length && /[0-9a-fA-F]/.test(text[pos] ?? "")) pos += 1;
        if (pos === hexStart) throw new CompileError(line, "hexadecimal literal with no digits");
      } else {
        while (pos < length && isDigit(text[pos] ?? "")) pos += 1;
        if (text[pos] === ".") {
          isFloat = true;
          pos += 1;
          while (pos < length && isDigit(text[pos] ?? "")) pos += 1;
        }
        if (text[pos] === "e" || text[pos] === "E") {
          isFloat = true;
          pos += 1;
          if (text[pos] === "+" || text[pos] === "-") pos += 1;
          const expStart = pos;
          while (pos < length && isDigit(text[pos] ?? "")) pos += 1;
          if (pos === expStart) throw new CompileError(line, "exponent with no digits in a float literal");
        }
      }
      let spelled = text.slice(start, pos);
      // Suffixes: f/F marks a float (legal in ES 3.00); u/U spells uint, which is outside the subset.
      if (text[pos] === "f" || text[pos] === "F") {
        isFloat = true;
        pos += 1;
      } else if (text[pos] === "u" || text[pos] === "U") {
        throw new CompileError(line, "unsigned integer literals ('u' suffix) are outside the subset; use a plain int");
      }
      const value = spelled.startsWith("0x") || spelled.startsWith("0X") ? parseInt(spelled, 16) : Number(spelled);
      if (!Number.isFinite(value)) throw new CompileError(line, `malformed numeric literal '${spelled}'`);
      tokens.push({ kind: isFloat ? "float" : "int", text: spelled, value, line });
      continue;
    }

    // Punctuators, longest first.
    let matched: string | null = null;
    for (const p of PUNCTUATORS) {
      if (text.startsWith(p, pos)) {
        matched = p;
        break;
      }
    }
    if (matched === null) {
      throw new CompileError(line, `unexpected character '${c}'`);
    }
    if (BITWISE.has(matched)) {
      throw new CompileError(line, `the bitwise operator '${matched}' is outside the subset`);
    }
    if (matched === "%=") {
      throw new CompileError(line, "the '%=' compound assignment is outside the subset");
    }
    tokens.push({ kind: "punct", text: matched, value: 0, line });
    pos += matched.length;
  }

  tokens.push({ kind: "eof", text: "<end of shader>", value: 0, line });
  return tokens;
}
