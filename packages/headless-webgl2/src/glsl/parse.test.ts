import { describe, expect, it } from "vitest";
import { CompileError } from "./ast";
import { parse } from "./parse";

/**
 * The parser alone: declaration and statement shapes, and the parse-level
 * refusal table — every construct GLSL has but the subset excludes must fail
 * with a message naming it, never a bare "unexpected token". Typing and the
 * semantic refusals live in the check suite.
 */

const V = "#version 300 es\n";

function parseErr(source: string): string {
  try {
    parse(V + source);
  } catch (error) {
    if (error instanceof CompileError) return error.message;
    throw error;
  }
  throw new Error("expected the source to fail parsing");
}

describe("shapes the parser accepts", () => {
  it("parses globals of every qualifier, with layout locations and arrays", () => {
    const ast = parse(`${V}
      layout(location = 3) in vec3 a_pos;
      out vec2 v_uv;
      uniform mat4 u_mvp;
      uniform vec4 u_lights[64];
      const float PI = 3.5;
      void main() {}
    `);
    expect(ast.globals.map((g) => g.name)).toEqual([
      "a_pos",
      "v_uv",
      "u_mvp",
      "u_lights",
      "PI",
    ]);
    expect(ast.globals[0]?.layoutLocation).toBe(3);
    expect(ast.globals[3]?.arraySize).not.toBeNull();
    expect(ast.functions.map((f) => f.name)).toEqual(["main"]);
  });

  it("parses precision declarations and precision qualifiers by dropping them", () => {
    const ast = parse(`${V}
      precision highp float;
      precision mediump int;
      uniform highp vec3 u_a;
      void main() { lowp float x = 1.0; }
    `);
    expect(ast.globals).toHaveLength(1);
  });

  it("parses helper functions with value parameters, including the in qualifier", () => {
    const ast = parse(`${V}
      float f(in float a, const float b, vec3 c) { return a; }
      void main() {}
    `);
    expect(ast.functions[0]?.params.map((p) => p.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("parses if/else chains, for loops, and single-statement branches wrapped as blocks", () => {
    const ast = parse(`${V}
      void main() {
        float x = 0.0;
        if (x < 1.0) x = 2.0;
        else if (x < 3.0) { x = 4.0; }
        else x = 5.0;
        for (int i = 0; i < 4; i++) x = x + 1.0;
      }
    `);
    // Three statements: the declaration, the whole if/else chain, the loop.
    expect(ast.functions[0]?.body.statements).toHaveLength(3);
  });

  it("parses multiple declarators in one declaration", () => {
    const ast = parse(`${V}void main() { float a = 1.0, b = 2.0, c; }`);
    const stmt = ast.functions[0]?.body.statements[0];
    expect(stmt?.node).toBe("var");
    if (stmt?.node === "var")
      expect(stmt.declarators.map((d) => d.name)).toEqual(["a", "b", "c"]);
  });

  it("carries source lines on nodes for the error logs", () => {
    const ast = parse(`${V}\nuniform vec3 u_a;\nvoid main() {}`);
    expect(ast.globals[0]?.line).toBe(3);
    expect(ast.functions[0]?.line).toBe(4);
  });
});

describe("the parse-level refusal table", () => {
  /** Each excluded construct with the phrase its refusal must carry. */
  const table: [construct: string, source: string, message: RegExp][] = [
    [
      "while",
      "void main() { while (true) {} }",
      /'while' loop is outside the subset; use a for-loop/,
    ],
    [
      "do-while",
      "void main() { do {} while (true); }",
      /'do-while' loop is outside the subset/,
    ],
    [
      "switch",
      "void main() { switch (1) {} }",
      /'switch' is outside the subset; use if\/else/,
    ],
    [
      "break",
      "void main() { for (int i = 0; i < 4; i++) { break; } }",
      /'break' is outside the subset/,
    ],
    [
      "continue",
      "void main() { for (int i = 0; i < 4; i++) { continue; } }",
      /'continue' is outside the subset/,
    ],
    [
      "struct",
      "struct Light { float x; };",
      /'struct' is outside the subset; use parallel scalar\/vector declarations/,
    ],
    [
      "uint",
      "uniform uint u_x;",
      /unsigned integer types are outside the subset/,
    ],
    [
      "uvec3",
      "uniform uvec3 u_x;",
      /unsigned integer types are outside the subset/,
    ],
    [
      "mat2",
      "uniform mat2 u_m;",
      /'mat2' is outside the subset; only the square mat3 and mat4 exist/,
    ],
    [
      "mat2x3",
      "uniform mat2x3 u_m;",
      /non-square matrix types are outside the subset/,
    ],
    [
      "mat4x3",
      "uniform mat4x3 u_m;",
      /non-square matrix types are outside the subset/,
    ],
    [
      "sampler3D",
      "uniform sampler3D u_s;",
      /'sampler3D' is outside the subset; only sampler2D exists/,
    ],
    [
      "samplerCube",
      "uniform samplerCube u_s;",
      /'samplerCube' is outside the subset/,
    ],
    [
      "isampler2D",
      "uniform isampler2D u_s;",
      /integer sampler types are outside the subset/,
    ],
    [
      "mat2 constructor",
      "void main() { vec2 v = mat2(1.0) * vec2(1.0); }",
      /'mat2' is outside the subset/,
    ],
    [
      "out parameter",
      "void f(out float x) {} void main() {}",
      /'out' function parameters are outside the subset; parameters pass by value/,
    ],
    [
      "inout parameter",
      "void f(inout float x) {} void main() {}",
      /'inout' function parameters are outside the subset/,
    ],
    [
      "array parameter",
      "void f(float xs[4]) {} void main() {}",
      /array function parameters are outside the subset/,
    ],
    [
      "function prototype",
      "float f(float x); void main() {}",
      /prototype for 'f' is outside the subset; define helper functions before their first call/,
    ],
    [
      "local array",
      "void main() { float xs[4]; }",
      /local array 'xs' is outside the subset; only uniform declarations may be arrays/,
    ],
    [
      "unqualified global",
      "float g_state; void main() {}",
      /'g_state' has no qualifier; unqualified mutable globals are outside the subset/,
    ],
    [
      "flat varying",
      "flat in float v_id; void main() {}",
      /'flat' interpolation qualifier is outside the subset/,
    ],
    [
      "centroid",
      "centroid in vec2 v_uv; void main() {}",
      /'centroid' qualifier is outside the subset/,
    ],
    [
      "invariant",
      "invariant out vec4 v_p; void main() {}",
      /'invariant' qualifier is outside the subset/,
    ],
    [
      "increment in expression",
      "void main() { int i = 0; int j = i++ + 1; }",
      /increment\/decrement is a statement/,
    ],
    [
      "prefix increment in expression",
      "void main() { int i = 0; int j = ++i; }",
      /increment\/decrement is a statement/,
    ],
    [
      "for without declared counter",
      "void main() { int i; for (i = 0; i < 4; i++) {} }",
      /must declare its own int counter/,
    ],
    [
      "for counter without initializer",
      "void main() { for (int i; i < 4; i++) {} }",
      /counter needs an initializer/,
    ],
    [
      "for with equality condition",
      "void main() { for (int i = 0; i != 4; i++) {} }",
      /condition must compare the counter with <, <=, >, or >=/,
    ],
    [
      "for updating another variable",
      "void main() { int j = 0; for (int i = 0; i < 4; j++) {} }",
      /must step the loop's own counter 'i', got 'j'/,
    ],
    [
      "for with strange update",
      "void main() { for (int i = 0; i < 4; i = 9) {} }",
      /update must be \+\+, --, \+=, or -=/,
    ],
  ];

  for (const [construct, source, message] of table) {
    it(`refuses ${construct} by name`, () => {
      expect(parseErr(source)).toMatch(message);
    });
  }

  it("reports the failing line in the CompileError", () => {
    try {
      parse(`${V}\nvoid main() {\n  while (true) {}\n}`);
      expect.unreachable("parse should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError);
      expect((error as CompileError).line).toBe(4);
      expect((error as CompileError).toLog()).toMatch(/^ERROR: 0:4: /);
    }
  });
});
