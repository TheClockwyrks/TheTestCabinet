import { describe, expect, it } from "vitest";
import { compileStage, linkStages, type LinkedProgram, type SamplerFn } from "./link";

/**
 * Numeric evaluation of the emitted stage functions — the executable half of
 * the front end. Every test compiles real subset GLSL through the same
 * compile → link → `new Function` path the context uses, then invokes the
 * resulting vertex/fragment functions with hand-built register files and
 * asserts hand-computed numbers. Refusals live in the lex/parse/check suites;
 * cross-stage layout rules in the link suite.
 */

const V = "#version 300 es\n";

/** A vertex shader that satisfies the linker while a test focuses on the fragment stage. */
function passthroughVertex(varyingDecls: readonly string[]): string {
  return `${V}${varyingDecls.map((decl) => `out ${decl};\n`).join("")}void main() { gl_Position = vec4(0.0); }`;
}

/** Compiles and links, throwing the info log so a broken test shader reads as its own message. */
function link(vertexSource: string, fragmentSource: string): LinkedProgram {
  const vertex = compileStage(vertexSource, "vertex");
  if (!vertex.ok) throw new Error(`vertex: ${vertex.log}`);
  const fragment = compileStage(fragmentSource, "fragment");
  if (!fragment.ok) throw new Error(`fragment: ${fragment.log}`);
  const linked = linkStages(vertex.shader, fragment.shader, new Map());
  if (!linked.ok) throw new Error(`link: ${linked.log}`);
  return linked.program;
}

/** Links a fragment-only test program, mirroring its varying declarations into the vertex stage. */
function fragProgram(fragmentBody: string, varyingDecls: readonly string[] = []): LinkedProgram {
  const fragmentSource = `${V}${varyingDecls.map((decl) => `in ${decl};\n`).join("")}out vec4 o_color;\n${fragmentBody}`;
  return link(passthroughVertex(varyingDecls), fragmentSource);
}

/** Writes named uniform values into a fresh flat store by the linker's slots. */
function uniformStore(program: LinkedProgram, values: Record<string, readonly number[]> = {}): Float64Array {
  const store = new Float64Array(program.uniformSlotCount);
  for (const [name, components] of Object.entries(values)) {
    const uniform = program.uniforms.find((u) => u.baseName === name);
    if (uniform === undefined) throw new Error(`no uniform '${name}' in the linked program`);
    for (let i = 0; i < components.length; i += 1) store[uniform.slot + i] = components[i] ?? 0;
  }
  return store;
}

interface FragOptions {
  readonly uniforms?: Record<string, readonly number[]>;
  /** Interpolated varying components, in fragment-input declaration order. */
  readonly varyings?: readonly number[];
  readonly fragCoord?: readonly [number, number, number, number];
  readonly frontFacing?: boolean;
  readonly samplers?: readonly SamplerFn[];
}

/** Invokes the fragment function once, returning the raw f64 color and the discard flag. */
function runFrag(program: LinkedProgram, options: FragOptions = {}): { color: number[]; discarded: boolean } {
  const varyings = new Float64Array(program.varyingComponents);
  (options.varyings ?? []).forEach((value, i) => {
    varyings[i] = value;
  });
  const out = new Float64Array(4);
  const discarded = program.fragment(
    varyings,
    uniformStore(program, options.uniforms),
    options.samplers ?? [],
    Float64Array.from(options.fragCoord ?? [0, 0, 0, 1]),
    options.frontFacing ?? true,
    out,
  );
  return { color: [...out], discarded };
}

/** One-liner for the common shape: a fragment main assigning o_color once. */
function evalColor(expression: string, options: FragOptions = {}, prelude = "", varyingDecls: readonly string[] = []): number[] {
  const program = fragProgram(`${prelude}\nvoid main() { o_color = ${expression}; }`, varyingDecls);
  return runFrag(program, options).color;
}

/* ---------------------------------------------------------------------- */
/* Expressions                                                            */
/* ---------------------------------------------------------------------- */

describe("expression evaluation", () => {
  it("computes float arithmetic with GLSL precedence and grouping", () => {
    expect(evalColor("vec4(2.0 + 3.0 * 4.0, (2.0 + 3.0) * 4.0, 10.0 / 4.0, 7.0 - 0.5)")).toEqual([14, 20, 2.5, 6.5]);
  });

  it("truncates int division toward zero, the GLSL rule f64 division would miss", () => {
    expect(evalColor("vec4(float(7 / 2), float(-7 / 2), float(7 % 3), float(-7 % 3))")).toEqual([3, -3, 1, -1]);
  });

  it("applies unary minus componentwise and unary ! to bools", () => {
    expect(evalColor("vec4(-vec2(1.5, -2.0), (!false) ? 1.0 : 0.0, (!true) ? 1.0 : 0.0)")).toEqual([-1.5, 2, 1, 0]);
  });

  it("broadcasts a scalar over a vector in arithmetic, both sides", () => {
    expect(evalColor("vec4(vec3(1.0, 2.0, 3.0) * 2.0, 10.0 - 1.0)")).toEqual([2, 4, 6, 9]);
    expect(evalColor("vec4(2.0 * vec3(1.0, 2.0, 3.0), 1.0 / 4.0)")).toEqual([2, 4, 6, 0.25]);
  });

  it("converts int literals and ivec constructors to float implicitly", () => {
    expect(evalColor("vec4(1, vec2(2, 3) + 1, float(ivec2(9, 9).x))")).toEqual([1, 3, 4, 9]);
  });

  it("selects through nested ternaries by the bool condition", () => {
    const program = fragProgram(`
      uniform float u_x;
      void main() { o_color = vec4(u_x < 1.0 ? 10.0 : u_x < 2.0 ? 20.0 : 30.0); }
    `);
    expect(runFrag(program, { uniforms: { u_x: [0.5] } }).color[0]).toBe(10);
    expect(runFrag(program, { uniforms: { u_x: [1.5] } }).color[0]).toBe(20);
    expect(runFrag(program, { uniforms: { u_x: [2.5] } }).color[0]).toBe(30);
  });

  it("evaluates comparisons, &&, ||, and ^^ over scalars", () => {
    expect(evalColor("vec4((1.0 < 2.0 && 3.0 >= 3.0) ? 1.0 : 0.0, (1.0 > 2.0 || 5.0 != 4.0) ? 1.0 : 0.0, (true ^^ true) ? 1.0 : 0.0, (true ^^ false) ? 1.0 : 0.0)")).toEqual([1, 1, 0, 1]);
  });

  it("compares whole vectors with == and != by all-components equality", () => {
    expect(evalColor("vec4(vec3(1.0, 2.0, 3.0) == vec3(1.0, 2.0, 3.0) ? 1.0 : 0.0, vec3(1.0, 2.0, 3.0) == vec3(1.0, 9.0, 3.0) ? 1.0 : 0.0, vec2(1.0) != vec2(1.0) ? 1.0 : 0.0, 1.0)")).toEqual([1, 0, 0, 1]);
  });

  it("keeps a bool uniform comparable with true and false literals under ==", () => {
    // The store holds 0/1 numbers; the read must surface as a real JS boolean
    // or `u_on == false` would strict-compare a number against false forever.
    const program = fragProgram(`
      uniform bool u_on;
      void main() { o_color = vec4(u_on == true ? 1.0 : 0.0, u_on == false ? 1.0 : 0.0, u_on ? 1.0 : 0.0, !u_on ? 1.0 : 0.0); }
    `);
    expect(runFrag(program, { uniforms: { u_on: [1] } }).color).toEqual([1, 0, 1, 0]);
    expect(runFrag(program, { uniforms: { u_on: [0] } }).color).toEqual([0, 1, 0, 1]);
  });
});

/* ---------------------------------------------------------------------- */
/* Swizzles                                                               */
/* ---------------------------------------------------------------------- */

describe("swizzles", () => {
  it("reads any component order across the xyzw, rgba, and stpq sets", () => {
    const prelude = "uniform vec4 u_v;";
    const options: FragOptions = { uniforms: { u_v: [1, 2, 3, 4] } };
    expect(evalColor("u_v.wzyx", options, prelude)).toEqual([4, 3, 2, 1]);
    expect(evalColor("vec4(u_v.rg, u_v.ba)", options, prelude)).toEqual([1, 2, 3, 4]);
    expect(evalColor("vec4(u_v.tp, u_v.ss)", options, prelude)).toEqual([2, 3, 1, 1]);
  });

  it("writes through a swizzle l-value, touching only the named components", () => {
    const program = fragProgram(`
      void main() {
        vec4 v = vec4(1.0, 2.0, 3.0, 4.0);
        v.xz = vec2(10.0, 30.0);
        o_color = v;
      }
    `);
    expect(runFrag(program).color).toEqual([10, 2, 30, 4]);
  });

  it("swaps components through an aliasing swizzle assignment (v.xy = v.yx)", () => {
    const program = fragProgram(`
      void main() {
        vec4 v = vec4(1.0, 2.0, 3.0, 4.0);
        v.xy = v.yx;
        o_color = v;
      }
    `);
    // Both old values must be read before either store, or the swap halves.
    expect(runFrag(program).color).toEqual([2, 1, 3, 4]);
  });

  it("compound-assigns through a swizzle l-value", () => {
    const program = fragProgram(`
      void main() {
        vec4 v = vec4(1.0, 2.0, 3.0, 4.0);
        v.yw *= 10.0;
        o_color = v;
      }
    `);
    expect(runFrag(program).color).toEqual([1, 20, 3, 40]);
  });

  it("chains a swizzle of a swizzle", () => {
    expect(evalColor("vec4(u_v.wzy.yx, 0.0, 0.0)", { uniforms: { u_v: [1, 2, 3, 4] } }, "uniform vec4 u_v;")).toEqual([3, 4, 0, 0]);
  });

  it("indexes a vector with a constant and with a dynamic uniform int", () => {
    const program = fragProgram(`
      uniform int u_i;
      void main() {
        vec3 v = vec3(10.0, 20.0, 30.0);
        o_color = vec4(v[0], v[2], v[u_i], 0.0);
      }
    `);
    expect(runFrag(program, { uniforms: { u_i: [1] } }).color).toEqual([10, 30, 20, 0]);
    expect(runFrag(program, { uniforms: { u_i: [2] } }).color).toEqual([10, 30, 30, 0]);
  });
});

/* ---------------------------------------------------------------------- */
/* Matrix math                                                            */
/* ---------------------------------------------------------------------- */

describe("matrix math", () => {
  it("multiplies mat4 by vec4 column-major, matching the constructor's argument order", () => {
    // Columns: (1,0,0,0), (0,2,0,0), (0,0,3,0), (4,5,6,1) — a scale+translate.
    const program = fragProgram(`
      void main() {
        mat4 m = mat4(1.0, 0.0, 0.0, 0.0,  0.0, 2.0, 0.0, 0.0,  0.0, 0.0, 3.0, 0.0,  4.0, 5.0, 6.0, 1.0);
        o_color = m * vec4(1.0, 1.0, 1.0, 1.0);
      }
    `);
    expect(runFrag(program).color).toEqual([5, 7, 9, 1]);
  });

  it("multiplies mat3 by mat3 as the linear-algebra product", () => {
    // a scales by (2,3,4); b is a cyclic permutation; (a*b)*v = a*(b*v).
    const program = fragProgram(`
      void main() {
        mat3 a = mat3(2.0, 0.0, 0.0,  0.0, 3.0, 0.0,  0.0, 0.0, 4.0);
        mat3 b = mat3(0.0, 1.0, 0.0,  0.0, 0.0, 1.0,  1.0, 0.0, 0.0);
        o_color = vec4((a * b) * vec3(1.0, 2.0, 3.0), 0.0);
      }
    `);
    // b*v = (v.z, v.x, v.y) = (3,1,2); a*that = (6,3,8).
    expect(runFrag(program).color).toEqual([6, 3, 8, 0]);
  });

  it("multiplies vec by mat as the row-vector product", () => {
    const program = fragProgram(`
      void main() {
        mat3 m = mat3(1.0, 2.0, 3.0,  4.0, 5.0, 6.0,  7.0, 8.0, 9.0);
        o_color = vec4(vec3(1.0, 0.0, 0.0) * m, 0.0);
      }
    `);
    // Row-vector times m picks the dot of v with each column: (1, 4, 7).
    expect(runFrag(program).color).toEqual([1, 4, 7, 0]);
  });

  it("builds a diagonal matrix from a single scalar", () => {
    expect(evalColor("vec4(mat3(2.0) * vec3(1.0, 1.0, 1.0), 0.0)")).toEqual([2, 2, 2, 0]);
  });

  it("extracts the upper-left of a mat4 with the mat3 constructor", () => {
    const program = fragProgram(`
      uniform mat4 u_m;
      void main() { o_color = vec4(mat3(u_m) * vec3(1.0, 1.0, 1.0), 0.0); }
    `);
    // Columns of u_m: only the 3×3 corner matters; translation must drop out.
    const m = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 0, 100, 200, 300, 1];
    expect(runFrag(program, { uniforms: { u_m: m } }).color).toEqual([1, 2, 3, 0]);
  });

  it("indexes a matrix column by constant and by dynamic index", () => {
    const program = fragProgram(`
      uniform int u_c;
      void main() {
        mat3 m = mat3(1.0, 2.0, 3.0,  4.0, 5.0, 6.0,  7.0, 8.0, 9.0);
        o_color = vec4(m[1].y, m[u_c].x, m[u_c].z, 0.0);
      }
    `);
    expect(runFrag(program, { uniforms: { u_c: [2] } }).color).toEqual([5, 7, 9, 0]);
    expect(runFrag(program, { uniforms: { u_c: [0] } }).color).toEqual([5, 1, 3, 0]);
  });

  it("assigns a matrix column through a constant-index l-value", () => {
    const program = fragProgram(`
      void main() {
        mat3 m = mat3(1.0);
        m[2] = vec3(7.0, 8.0, 9.0);
        o_color = vec4(m * vec3(0.0, 0.0, 1.0), 0.0);
      }
    `);
    expect(runFrag(program).color).toEqual([7, 8, 9, 0]);
  });

  it("keeps m *= m reading consistent old values through the aliasing barrier", () => {
    const program = fragProgram(`
      void main() {
        mat3 m = mat3(0.0, 1.0, 0.0,  0.0, 0.0, 1.0,  1.0, 0.0, 0.0);
        m *= m;
        o_color = vec4(m * vec3(1.0, 2.0, 3.0), 0.0);
      }
    `);
    // The cyclic permutation squared shifts twice: m²·v = (v.y, v.z, v.x).
    expect(runFrag(program).color).toEqual([2, 3, 1, 0]);
  });

  it("adds and scalar-scales matrices componentwise", () => {
    const program = fragProgram(`
      void main() {
        mat3 m = mat3(1.0) + mat3(1.0);
        m = m * 0.5;
        o_color = vec4(m * vec3(3.0, 5.0, 7.0), 0.0);
      }
    `);
    expect(runFrag(program).color).toEqual([3, 5, 7, 0]);
  });
});

/* ---------------------------------------------------------------------- */
/* Uniform arrays and loops                                               */
/* ---------------------------------------------------------------------- */

describe("uniform arrays and loops", () => {
  it("accumulates a 64-entry light array over a uniform-bounded loop, the engines' lighting shape", () => {
    const program = fragProgram(`
      uniform vec4 u_lights[64];
      uniform int u_count;
      void main() {
        vec3 sum = vec3(0.0);
        for (int i = 0; i < u_count; i++) {
          sum += u_lights[i].rgb * u_lights[i].a;
        }
        o_color = vec4(sum, 1.0);
      }
    `);
    const lights = new Array<number>(64 * 4).fill(0);
    // Three lights: (1,0,0)×0.5, (0,1,0)×1, (0,0,1)×2 — and a fourth the
    // count must exclude.
    lights.splice(0, 12, 1, 0, 0, 0.5, 0, 1, 0, 1, 0, 0, 1, 2);
    lights.splice(12, 4, 9, 9, 9, 9);
    expect(runFrag(program, { uniforms: { u_lights: lights, u_count: [3] } }).color).toEqual([0.5, 1, 2, 1]);
  });

  it("indexes a mat4 uniform array dynamically, the skinning-palette shape", () => {
    const program = fragProgram(`
      uniform mat4 u_bones[4];
      uniform int u_bone;
      void main() { o_color = u_bones[u_bone] * vec4(1.0, 0.0, 0.0, 1.0); }
    `);
    const bones = new Array<number>(4 * 16).fill(0);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const translated = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1];
    bones.splice(0, 16, ...identity);
    bones.splice(2 * 16, 16, ...translated);
    expect(runFrag(program, { uniforms: { u_bones: bones, u_bone: [0] } }).color).toEqual([1, 0, 0, 1]);
    expect(runFrag(program, { uniforms: { u_bones: bones, u_bone: [2] } }).color).toEqual([6, 6, 7, 1]);
  });

  it("clamps a dynamic array index into range, the deterministic out-of-bounds rule", () => {
    const program = fragProgram(`
      uniform vec4 u_xs[3];
      uniform int u_i;
      void main() { o_color = u_xs[u_i]; }
    `);
    const xs = [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3];
    expect(runFrag(program, { uniforms: { u_xs: xs, u_i: [99] } }).color).toEqual([3, 3, 3, 3]);
    expect(runFrag(program, { uniforms: { u_xs: xs, u_i: [-7] } }).color).toEqual([1, 1, 1, 1]);
  });

  it("reads a constant array index without the clamp detour", () => {
    const program = fragProgram(`
      uniform float u_xs[5];
      void main() { o_color = vec4(u_xs[0], u_xs[4], 0.0, 0.0); }
    `);
    expect(runFrag(program, { uniforms: { u_xs: [10, 0, 0, 0, 50] } }).color).toEqual([10, 50, 0, 0]);
  });

  it("runs const-bound loops with += steps and downward -- loops", () => {
    const program = fragProgram(`
      const int N = 8;
      void main() {
        float evens = 0.0;
        for (int i = 0; i < N; i += 2) { evens += float(i); }
        float down = 0.0;
        for (int j = 3; j >= 1; j--) { down += float(j); }
        o_color = vec4(evens, down, 0.0, 0.0);
      }
    `);
    // 0+2+4+6 = 12; 3+2+1 = 6.
    expect(runFrag(program).color).toEqual([12, 6, 0, 0]);
  });

  it("nests loops with independent counters", () => {
    const program = fragProgram(`
      void main() {
        float n = 0.0;
        for (int i = 0; i < 3; i++) {
          for (int j = 0; j < 4; j++) { n += 1.0; }
        }
        o_color = vec4(n);
      }
    `);
    expect(runFrag(program).color[0]).toBe(12);
  });

  it("runs zero iterations when a uniform bound is zero", () => {
    const program = fragProgram(`
      uniform int u_n;
      void main() {
        float n = 0.0;
        for (int i = 0; i < u_n; i++) { n += 1.0; }
        o_color = vec4(n, 1.0, 0.0, 0.0);
      }
    `);
    expect(runFrag(program, { uniforms: { u_n: [0] } }).color).toEqual([0, 1, 0, 0]);
  });
});

/* ---------------------------------------------------------------------- */
/* User functions                                                         */
/* ---------------------------------------------------------------------- */

describe("user functions", () => {
  it("calls a scalar helper with converted int arguments", () => {
    const program = fragProgram(`
      float twice(float x) { return x * 2.0; }
      void main() { o_color = vec4(twice(3), twice(0.25), 0.0, 0.0); }
    `);
    expect(runFrag(program).color).toEqual([6, 0.5, 0, 0]);
  });

  it("keeps two calls to a vector-returning helper distinct despite the shared return scratch", () => {
    const program = fragProgram(`
      vec3 splat(float x) { return vec3(x, x + 1.0, x + 2.0); }
      void main() { o_color = vec4(splat(10.0).x + splat(20.0).x, splat(10.0).z, 0.0, 0.0); }
    `);
    // The scratch is reused per call; components must be copied out between.
    expect(runFrag(program).color).toEqual([30, 12, 0, 0]);
  });

  it("lets a helper read uniforms — globals resolve inside helper bodies", () => {
    // The regression this pins: helpers are emitted at the outer scope, so a
    // free `U` inside one must still reach the register files.
    const program = fragProgram(`
      uniform float u_scale;
      float scaled(float x) { return x * u_scale; }
      void main() { o_color = vec4(scaled(2.0), scaled(3.0), 0.0, 0.0); }
    `);
    expect(runFrag(program, { uniforms: { u_scale: [10] } }).color).toEqual([20, 30, 0, 0]);
  });

  it("lets a helper read varyings and gl_FragCoord", () => {
    const program = fragProgram(
      `
      float mixIn(float x) { return x + v_t + gl_FragCoord.x; }
      void main() { o_color = vec4(mixIn(1.0), 0.0, 0.0, 0.0); }
      `,
      ["float v_t"],
    );
    expect(runFrag(program, { varyings: [5], fragCoord: [100, 0, 0, 1] }).color[0]).toBe(106);
  });

  it("returns early out of a helper through an if branch", () => {
    const program = fragProgram(`
      float pick(float x) {
        if (x > 0.5) { return 1.0; }
        return 0.0;
      }
      void main() { o_color = vec4(pick(0.9), pick(0.1), 0.0, 0.0); }
    `);
    expect(runFrag(program).color).toEqual([1, 0, 0, 0]);
  });

  it("runs a void helper called as a statement, including one that writes the stage output", () => {
    const program = fragProgram(`
      uniform vec3 u_tint;
      void paint(float a) { o_color = vec4(u_tint, a); }
      void main() { paint(0.5); }
    `);
    expect(runFrag(program, { uniforms: { u_tint: [0.1, 0.2, 0.3] } }).color).toEqual([0.1, 0.2, 0.3, 0.5]);
  });

  it("passes vectors and matrices by value, so a callee mutation stays local", () => {
    const program = fragProgram(`
      vec3 bump(vec3 v) { v.x += 100.0; return v; }
      void main() {
        vec3 v = vec3(1.0, 2.0, 3.0);
        vec3 w = bump(v);
        o_color = vec4(v.x, w.x, 0.0, 0.0);
      }
    `);
    expect(runFrag(program).color).toEqual([1, 101, 0, 0]);
  });
});

/* ---------------------------------------------------------------------- */
/* Built-ins                                                              */
/* ---------------------------------------------------------------------- */

describe("built-in functions", () => {
  it("evaluates the componentwise math library to hand-computed values", () => {
    expect(evalColor("vec4(abs(-2.5), sign(-3.0), floor(1.7), ceil(1.2))")).toEqual([2.5, -1, 1, 2]);
    expect(evalColor("vec4(fract(1.75), mod(-1.5, 2.0), min(3.0, 2.0), max(vec2(1.0, 5.0), 2.0).y)")).toEqual([0.75, 0.5, 2, 5]);
    expect(evalColor("vec4(pow(2.0, 10.0), sqrt(6.25), exp2(3.0), log2(8.0))")).toEqual([1024, 2.5, 8, 3]);
    expect(evalColor("vec4(inversesqrt(4.0), sin(0.0), cos(0.0), tan(0.0))")).toEqual([0.5, 0, 1, 0]);
  });

  it("evaluates mod by the floor definition, so negatives wrap like GLSL and not like JS %", () => {
    // mod(-1.5, 2.0) is 0.5 in GLSL; JS -1.5 % 2.0 would be -1.5.
    expect(evalColor("vec4(mod(-1.5, 2.0), mod(5.5, 2.0), mod(vec2(-0.25, 3.5), 1.0))")).toEqual([0.5, 1.5, 0.75, 0.5]);
  });

  it("clamps, mixes, and steps with exact endpoints", () => {
    expect(evalColor("vec4(clamp(5.0, 0.0, 1.0), clamp(-1.0, 0.0, 1.0), clamp(0.25, 0.0, 1.0), 0.0)")).toEqual([1, 0, 0.25, 0]);
    // mix's x·(1−a) + y·a form reproduces both endpoints exactly at a=0 and 1.
    expect(evalColor("vec4(mix(3.0, 5.0, 0.0), mix(3.0, 5.0, 1.0), mix(3.0, 5.0, 0.5), mix(vec2(0.0, 10.0), vec2(1.0, 20.0), 0.5).y)")).toEqual([3, 5, 4, 15]);
    expect(evalColor("vec4(step(1.0, 0.5), step(1.0, 1.0), smoothstep(0.0, 1.0, 0.5), smoothstep(0.0, 1.0, 2.0))")).toEqual([0, 1, 0.5, 1]);
  });

  it("converts radians and degrees through the exact PI factors", () => {
    const [rad, deg] = evalColor("vec4(radians(180.0), degrees(3.141592653589793), 0.0, 0.0)");
    expect(rad).toBeCloseTo(Math.PI, 12);
    expect(deg).toBeCloseTo(180, 12);
  });

  it("computes the geometric functions against hand-checked vectors", () => {
    expect(evalColor("vec4(length(vec3(3.0, 4.0, 0.0)), distance(vec2(1.0, 1.0), vec2(4.0, 5.0)), dot(vec3(1.0, 2.0, 3.0), vec3(4.0, 5.0, 6.0)), 0.0)")).toEqual([5, 5, 32, 0]);
    expect(evalColor("vec4(cross(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0)), 0.0)")).toEqual([0, 0, 1, 0]);
    // normalize multiplies by a saved 1/len, so 3 · (1/5) carries the last-bit
    // f64 rounding of that product rather than the decimal 0.6 exactly.
    const [nx, ny, nz] = evalColor("vec4(normalize(vec3(0.0, 3.0, 4.0)), 0.0)");
    expect(nx).toBe(0);
    expect(ny).toBeCloseTo(0.6, 12);
    expect(nz).toBeCloseTo(0.8, 12);
    expect(evalColor("vec4(reflect(vec3(1.0, -1.0, 0.0), vec3(0.0, 1.0, 0.0)), 0.0)")).toEqual([1, 1, 0, 0]);
  });

  it("normalizes the zero vector to the zero vector, the pinned implementation-defined choice", () => {
    expect(evalColor("vec4(normalize(vec3(0.0)), 1.0)")).toEqual([0, 0, 0, 1]);
  });

  it("evaluates atan in both arities, with atan2 quadrant behavior", () => {
    const [a, b] = evalColor("vec4(atan(1.0), atan(1.0, -1.0), 0.0, 0.0)");
    expect(a).toBeCloseTo(Math.PI / 4, 12);
    expect(b).toBeCloseTo((3 * Math.PI) / 4, 12);
  });

  it("evaluates the vector relationals and any/all/not", () => {
    expect(
      evalColor(
        "vec4(any(lessThan(vec2(1.0, 5.0), vec2(2.0, 2.0))) ? 1.0 : 0.0, all(lessThan(vec2(1.0, 5.0), vec2(2.0, 2.0))) ? 1.0 : 0.0, all(not(greaterThan(vec2(1.0, 1.0), vec2(2.0, 2.0)))) ? 1.0 : 0.0, all(equal(vec2(1.0, 2.0), vec2(1.0, 2.0))) ? 1.0 : 0.0)",
      ),
    ).toEqual([1, 0, 1, 1]);
  });
});

/* ---------------------------------------------------------------------- */
/* Samplers, stage built-ins, discard                                     */
/* ---------------------------------------------------------------------- */

describe("samplers and stage built-ins", () => {
  /** A sampler stub that reports its own inputs, proving plumb-through. */
  const echoSampler: SamplerFn = (u, v, lod) => [u, v, lod, 1];

  it("routes texture() through the sampler at the uniform's texture unit", () => {
    const program = fragProgram(
      `
      uniform sampler2D u_map;
      void main() { o_color = texture(u_map, v_uv); }
      `,
      ["vec2 v_uv"],
    );
    const samplers: SamplerFn[] = [() => [9, 9, 9, 9], () => [9, 9, 9, 9], echoSampler];
    expect(runFrag(program, { uniforms: { u_map: [2] }, varyings: [0.25, 0.75], samplers }).color).toEqual([0.25, 0.75, 0, 1]);
  });

  it("passes the explicit lod of textureLod through to the sampler", () => {
    const program = fragProgram(`
      uniform sampler2D u_map;
      void main() { o_color = textureLod(u_map, vec2(0.5, 0.5), 3.0); }
    `);
    expect(runFrag(program, { uniforms: { u_map: [0] }, samplers: [echoSampler] }).color).toEqual([0.5, 0.5, 3, 1]);
  });

  it("copies sampler results into scalars so two lookups in one expression stay distinct", () => {
    const program = fragProgram(`
      uniform sampler2D u_map;
      void main() { o_color = texture(u_map, vec2(0.1, 0.0)) + texture(u_map, vec2(0.2, 0.0)); }
    `);
    // The sampler reuses one view; without the copy the first lookup's
    // components would silently become the second's.
    const view = new Float64Array(4);
    const reusing: SamplerFn = (u) => {
      view[0] = u;
      view[1] = u * 10;
      view[2] = 0;
      view[3] = 0;
      return view;
    };
    const { color } = runFrag(program, { uniforms: { u_map: [0] }, samplers: [reusing] });
    expect(color[0]).toBeCloseTo(0.3, 12);
    expect(color[1]).toBeCloseTo(3, 12);
  });

  it("exposes gl_FragCoord and gl_FrontFacing to the fragment stage", () => {
    const program = fragProgram(`
      void main() { o_color = vec4(gl_FragCoord.x, gl_FragCoord.y, gl_FragCoord.z, gl_FrontFacing ? 1.0 : 0.0); }
    `);
    expect(runFrag(program, { fragCoord: [12.5, 7.5, 0.25, 1], frontFacing: true }).color).toEqual([12.5, 7.5, 0.25, 1]);
    expect(runFrag(program, { fragCoord: [0, 0, 0, 1], frontFacing: false }).color[3]).toBe(0);
  });

  it("returns the discard flag and leaves color meaningless on the discarded path", () => {
    const program = fragProgram(`
      uniform float u_a;
      void main() {
        if (u_a < 0.5) discard;
        o_color = vec4(u_a);
      }
    `);
    expect(runFrag(program, { uniforms: { u_a: [0.1] } }).discarded).toBe(true);
    const kept = runFrag(program, { uniforms: { u_a: [0.9] } });
    expect(kept.discarded).toBe(false);
    expect(kept.color[0]).toBeCloseTo(0.9, 12);
  });
});

/* ---------------------------------------------------------------------- */
/* The vertex stage and the whole executable                              */
/* ---------------------------------------------------------------------- */

describe("the vertex stage and the executable pipeline", () => {
  it("transforms an attribute through an MVP uniform into gl_Position", () => {
    const program = link(
      `${V}
      layout(location = 0) in vec3 a_pos;
      uniform mat4 u_mvp;
      void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); }
      `,
      `${V}out vec4 o_color;\nvoid main() { o_color = vec4(1.0); }`,
    );
    const attributes = new Float64Array(16 * 4);
    attributes.set([1, 2, 3], 0 * 4);
    // Scale by 2 then translate by (10, 20, 30).
    const mvp = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 10, 20, 30, 1];
    const uniforms = uniformStore(program, { u_mvp: mvp });
    const varyings = new Float64Array(program.varyingComponents);
    const position = new Float64Array(4);
    program.vertex(attributes, uniforms, [], varyings, position);
    expect([...position]).toEqual([12, 24, 36, 1]);
  });

  it("fills unread attribute components with the (0, 0, 0, 1) defaults the fetch supplies", () => {
    const program = link(
      `${V}
      layout(location = 3) in vec2 a_uv;
      void main() { gl_Position = vec4(a_uv, 0.0, 1.0); }
      `,
      `${V}out vec4 o_color;\nvoid main() { o_color = vec4(1.0); }`,
    );
    const attributes = new Float64Array(16 * 4);
    attributes.set([0.5, 0.25, 99, 99], 3 * 4);
    const position = new Float64Array(4);
    program.vertex(attributes, uniformStore(program), [], new Float64Array(program.varyingComponents), position);
    // The shader reads only xy of location 3; the 99s must never surface.
    expect([...position]).toEqual([0.5, 0.25, 0, 1]);
  });

  it("carries varyings from the vertex writer to the fragment reader end to end", () => {
    const program = link(
      `${V}
      layout(location = 0) in vec3 a_pos;
      out vec3 v_color;
      out float v_fade;
      void main() {
        v_color = a_pos * 2.0;
        v_fade = a_pos.x;
        gl_Position = vec4(a_pos, 1.0);
      }
      `,
      `${V}
      in vec3 v_color;
      in float v_fade;
      out vec4 o_color;
      void main() { o_color = vec4(v_color, v_fade); }
      `,
    );
    const attributes = new Float64Array(16 * 4);
    attributes.set([0.5, 0.25, 0.125], 0);
    const uniforms = uniformStore(program);
    const varyings = new Float64Array(program.varyingComponents);
    const position = new Float64Array(4);
    program.vertex(attributes, uniforms, [], varyings, position);
    const out = new Float64Array(4);
    const discarded = program.fragment(varyings, uniforms, [], Float64Array.from([0, 0, 0, 1]), true, out);
    expect(discarded).toBe(false);
    expect([...out]).toEqual([1, 0.5, 0.25, 0.5]);
  });

  it("accepts a gl_PointSize write without disturbing the outputs", () => {
    const program = link(
      `${V}
      void main() { gl_PointSize = 8.0; gl_Position = vec4(0.5, 0.0, 0.0, 1.0); }
      `,
      `${V}out vec4 o_color;\nvoid main() { o_color = vec4(1.0); }`,
    );
    const position = new Float64Array(4);
    program.vertex(new Float64Array(16 * 4), uniformStore(program), [], new Float64Array(program.varyingComponents), position);
    expect([...position]).toEqual([0.5, 0, 0, 1]);
  });

  it("produces identical outputs from two independent compiles of the same source, the determinism bar", () => {
    const vertexSource = `${V}
      layout(location = 0) in vec3 a_pos;
      uniform mat4 u_mvp;
      out vec3 v_n;
      void main() { v_n = normalize(a_pos); gl_Position = u_mvp * vec4(a_pos, 1.0); }
    `;
    const fragmentSource = `${V}
      in vec3 v_n;
      uniform vec4 u_lights[8];
      uniform int u_count;
      out vec4 o_color;
      void main() {
        vec3 lit = vec3(0.0);
        for (int i = 0; i < u_count; i++) {
          lit += u_lights[i].rgb * max(dot(v_n, normalize(u_lights[i].xyz)), 0.0);
        }
        o_color = vec4(lit, 1.0);
      }
    `;
    const run = (program: LinkedProgram): number[] => {
      const attributes = new Float64Array(16 * 4);
      attributes.set([0.3, 0.7, 0.2], 0);
      const lights = [0.5, 0.5, 0.1, 1, 0.1, 0.9, 0.4, 1, ...new Array<number>(24).fill(0)];
      const uniforms = uniformStore(program, { u_mvp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], u_lights: lights, u_count: [2] });
      const varyings = new Float64Array(program.varyingComponents);
      const position = new Float64Array(4);
      program.vertex(attributes, uniforms, [], varyings, position);
      const out = new Float64Array(4);
      program.fragment(varyings, uniforms, [], Float64Array.from([0, 0, 0, 1]), true, out);
      return [...position, ...out];
    };
    const first = run(link(vertexSource, fragmentSource));
    const second = run(link(vertexSource, fragmentSource));
    expect(second).toEqual(first);
  });
});

/* ---------------------------------------------------------------------- */
/* Statements                                                             */
/* ---------------------------------------------------------------------- */

describe("statement forms", () => {
  it("shadows an outer local inside a nested block and restores it after", () => {
    const program = fragProgram(`
      void main() {
        float x = 1.0;
        { float x = 2.0; o_color.g = x; }
        o_color = vec4(x, o_color.g, 0.0, 0.0);
      }
    `);
    expect(runFrag(program).color).toEqual([1, 2, 0, 0]);
  });

  it("declares multiple locals in one statement, later ones seeing earlier ones", () => {
    const program = fragProgram(`
      void main() {
        float a = 2.0, b = a * 3.0, c;
        c = a + b;
        o_color = vec4(a, b, c, 0.0);
      }
    `);
    expect(runFrag(program).color).toEqual([2, 6, 8, 0]);
  });

  it("zero-initializes an uninitialized local, the deterministic reading of GLSL's undefined", () => {
    const program = fragProgram(`
      void main() {
        vec3 v;
        float f;
        o_color = vec4(v, f);
      }
    `);
    expect(runFrag(program).color).toEqual([0, 0, 0, 0]);
  });

  it("runs if / else-if / else chains down the correct branch", () => {
    const program = fragProgram(`
      uniform float u_x;
      void main() {
        if (u_x < 1.0) o_color = vec4(1.0, 0.0, 0.0, 1.0);
        else if (u_x < 2.0) o_color = vec4(0.0, 1.0, 0.0, 1.0);
        else o_color = vec4(0.0, 0.0, 1.0, 1.0);
      }
    `);
    expect(runFrag(program, { uniforms: { u_x: [0] } }).color).toEqual([1, 0, 0, 1]);
    expect(runFrag(program, { uniforms: { u_x: [1.5] } }).color).toEqual([0, 1, 0, 1]);
    expect(runFrag(program, { uniforms: { u_x: [5] } }).color).toEqual([0, 0, 1, 1]);
  });

  it("applies every compound assignment operator", () => {
    const program = fragProgram(`
      void main() {
        float x = 8.0;
        x += 2.0; x -= 1.0; x *= 3.0; x /= 2.0;
        int i = 5;
        i++; i--; i++;
        o_color = vec4(x, float(i), 0.0, 0.0);
      }
    `);
    expect(runFrag(program).color).toEqual([13.5, 6, 0, 0]);
  });

  it("inlines const globals, including vector consts built from other consts", () => {
    const program = fragProgram(`
      const float HALF = 0.5;
      const vec3 TINT = vec3(HALF, 1.0, 2.0 * HALF);
      void main() { o_color = vec4(TINT, HALF); }
    `);
    expect(runFrag(program).color).toEqual([0.5, 1, 1, 0.5]);
  });
});
