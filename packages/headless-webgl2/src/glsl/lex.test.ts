import { describe, expect, it } from "vitest";
import { CompileError } from "./ast";
import { tokenize } from "./lex";

/**
 * The lexer alone: token kinds, literal forms, line tracking, the #version
 * handling, and the lexical refusals (bitwise operators, uint suffixes, the
 * preprocessor). Parsing and typing live in the parse/check suites.
 */

const V = "#version 300 es\n";

function kinds(source: string): string[] {
  return tokenize(source).map((t) => `${t.kind}:${t.text}`);
}

describe("tokens and literals", () => {
  it("tokenizes identifiers, keywords, punctuation, and numbers", () => {
    expect(kinds(`${V}uniform vec3 u_pos;`)).toEqual([
      "keyword:uniform",
      "keyword:vec3",
      "ident:u_pos",
      "punct:;",
      "eof:<end of shader>",
    ]);
  });

  it("distinguishes int literals from float literals by dot, exponent, and f suffix", () => {
    const tokens = tokenize(`${V}1 1.5 .5 2e3 1.5e-2 3f 0x1F`);
    expect(tokens.map((t) => t.kind)).toEqual([
      "int",
      "float",
      "float",
      "float",
      "float",
      "float",
      "int",
      "eof",
    ]);
    expect(tokens.map((t) => t.value).slice(0, 7)).toEqual([
      1, 1.5, 0.5, 2000, 0.015, 3, 31,
    ]);
  });

  it("carries the true source line on every token, with the #version line counted", () => {
    const tokens = tokenize(`${V}\nfloat a;\n\nint b;`);
    const a = tokens.find((t) => t.text === "a");
    const b = tokens.find((t) => t.text === "b");
    expect(a?.line).toBe(3);
    expect(b?.line).toBe(5);
  });

  it("skips line comments and block comments, counting the lines a block comment spans", () => {
    const tokens = tokenize(`${V}// nothing\n/* two\nlines */ float x;`);
    const x = tokens.find((t) => t.text === "x");
    expect(x?.line).toBe(4);
    expect(tokens.filter((t) => t.kind !== "eof")).toHaveLength(3);
  });

  it("lexes multi-character punctuators greedily so <= never splits into < =", () => {
    expect(kinds(`${V}a <= b == c`).slice(0, 5)).toEqual([
      "ident:a",
      "punct:<=",
      "ident:b",
      "punct:==",
      "ident:c",
    ]);
  });
});

describe("the #version rule", () => {
  it("requires #version 300 es before any other content, naming the rule", () => {
    expect(() => tokenize("float x;")).toThrow(CompileError);
    expect(() => tokenize("float x;")).toThrow(
      /must begin with '#version 300 es'/,
    );
  });

  it("accepts comments and blank lines above the #version line", () => {
    expect(() =>
      tokenize("// header\n\n#version 300 es\nfloat x;"),
    ).not.toThrow();
  });

  it("refuses every other preprocessor directive by name", () => {
    expect(() => tokenize(`${V}#define FOO 1`)).toThrow(
      /preprocessor directives other than '#version 300 es' are outside the subset/,
    );
  });

  it("refuses a wrong version string as a missing #version", () => {
    expect(() => tokenize("#version 100\nfloat x;")).toThrow(
      /must begin with '#version 300 es'/,
    );
  });
});

describe("lexical refusals", () => {
  it("refuses each bitwise operator by name", () => {
    for (const op of ["&", "|", "^", "~", "<<", ">>"]) {
      expect(() => tokenize(`${V}a ${op} b`)).toThrow(
        new RegExp(`bitwise operator '\\${op[0]}`),
      );
    }
  });

  it("refuses the u suffix as an unsigned literal, pointing at plain int", () => {
    expect(() => tokenize(`${V}int x = 1u;`)).toThrow(
      /unsigned integer literals .* use a plain int/,
    );
  });

  it("refuses an unterminated block comment with its opening line", () => {
    let error: CompileError | null = null;
    try {
      tokenize(`${V}/* forever`);
    } catch (e) {
      error = e as CompileError;
    }
    expect(error).toBeInstanceOf(CompileError);
    expect(error?.line).toBe(2);
  });

  it("refuses a character outside the language", () => {
    expect(() => tokenize(`${V}float § = 1.0;`)).toThrow(
      /unexpected character/,
    );
  });
});
