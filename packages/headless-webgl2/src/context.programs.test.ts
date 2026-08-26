import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * The shader/program surface wired to the GLSL front end: compile logs and
 * statuses through the GL API, linking with real location tables, uniform
 * setters in every documented form, introspection, and the executable the
 * stage-3 rasterizer will run. Object lifecycle (create/attach/delete,
 * cross-context refusals) lives in objects.test.ts; the compiler's own
 * numeric behavior in glsl/emit.test.ts and its refusal tables in
 * glsl/lex|parse|check.test.ts.
 */

function makeGl(): HeadlessWebGL2 {
  return createCanvas(8, 8).getContext("webgl2");
}

const VERTEX_MINIMAL =
  "#version 300 es\nvoid main() { gl_Position = vec4(0.0); }";
const FRAGMENT_MINIMAL =
  "#version 300 es\nout vec4 o_color;\nvoid main() { o_color = vec4(1.0); }";

/** Compiles both stages and links them, asserting every step succeeded. */
function buildProgram(
  gl: HeadlessWebGL2,
  vertexSource: string,
  fragmentSource: string,
) {
  const vertex = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vertex, vertexSource);
  gl.compileShader(vertex);
  expect(gl.getShaderInfoLog(vertex)).toBe("");
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fragment, fragmentSource);
  gl.compileShader(fragment);
  expect(gl.getShaderInfoLog(fragment)).toBe("");
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  expect(gl.getProgramInfoLog(program)).toBe("");
  expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(true);
  return program;
}

/** The lighting-array program most uniform tests share. */
function buildLightsProgram(gl: HeadlessWebGL2) {
  return buildProgram(
    gl,
    "#version 300 es\nuniform mat4 u_mvp;\nvoid main() { gl_Position = u_mvp * vec4(1.0); }",
    `#version 300 es
    uniform vec4 u_lights[4];
    uniform int u_count;
    uniform sampler2D u_map;
    out vec4 o_color;
    void main() {
      vec3 sum = vec3(0.0);
      for (int i = 0; i < u_count; i++) { sum += u_lights[i].rgb; }
      o_color = vec4(sum, 1.0) + texture(u_map, vec2(0.5));
    }`,
  );
}

/* ---------------------------------------------------------------------- */
/* Compilation through the API                                            */
/* ---------------------------------------------------------------------- */

describe("compileShader through the API", () => {
  it("sets COMPILE_STATUS true with an empty info log for a subset shader", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(shader, FRAGMENT_MINIMAL);
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(true);
    expect(gl.getShaderInfoLog(shader)).toBe("");
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it("fails a broken shader with a line-numbered browser-shaped log, never a throw", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      shader,
      "#version 300 es\nout vec4 o_color;\nvoid main() {\n  o_color = missing;\n}",
    );
    expect(() => gl.compileShader(shader)).not.toThrow();
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    // Line 4 of the source, in the ERROR: 0:<line>: shape browsers use.
    expect(gl.getShaderInfoLog(shader)).toBe(
      "ERROR: 0:4: 'missing' is not declared",
    );
  });

  it("names an out-of-subset construct in the log rather than a bare syntax error", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      shader,
      "#version 300 es\nout vec4 o_color;\nvoid main() {\n  while (true) {}\n}",
    );
    gl.compileShader(shader);
    expect(gl.getShaderInfoLog(shader)).toMatch(
      /ERROR: 0:4: .*'while' loop is outside the subset; use a for-loop/,
    );
  });

  it("clears a stale failure once a corrected source recompiles", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(shader, "nonsense");
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    gl.shaderSource(shader, VERTEX_MINIMAL);
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(true);
    expect(gl.getShaderInfoLog(shader)).toBe("");
  });

  it("compiles each stage against its own built-ins, so gl_FragCoord fails in a vertex shader", () => {
    const gl = makeGl();
    const shader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      shader,
      "#version 300 es\nvoid main() { gl_Position = gl_FragCoord; }",
    );
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    expect(gl.getShaderInfoLog(shader)).toMatch(
      /'gl_FragCoord' does not exist in the vertex shader/,
    );
  });
});

/* ---------------------------------------------------------------------- */
/* Linking through the API                                                */
/* ---------------------------------------------------------------------- */

describe("linkProgram through the API", () => {
  it("links a full program, fills the location tables, and mints the executable", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    expect(gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES)).toBe(0);
    expect(gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)).toBe(4);
    expect(program.executable).not.toBeNull();
    expect(program.uniformStore).toHaveLength(16 + 16 + 1 + 1);
  });

  it("reports a varying mismatch through LINK_STATUS false and the program info log", () => {
    const gl = makeGl();
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vertex, VERTEX_MINIMAL);
    gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(
      fragment,
      "#version 300 es\nin vec3 v_normal;\nout vec4 o_color;\nvoid main() { o_color = vec4(v_normal, 1.0); }",
    );
    gl.compileShader(fragment);
    expect(gl.getShaderParameter(fragment, gl.COMPILE_STATUS)).toBe(true);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    expect(() => gl.linkProgram(program)).not.toThrow();
    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(program)).toMatch(
      /fragment input 'v_normal' has no matching vertex output/,
    );
    expect(program.executable).toBeNull();
  });

  it("honors bindAttribLocation at the next link and layout qualifiers over it", () => {
    const gl = makeGl();
    const vertex = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(
      vertex,
      "#version 300 es\nlayout(location = 6) in vec3 a_pos;\nin vec2 a_uv;\nvoid main() { gl_Position = vec4(a_pos, a_uv.x); }",
    );
    gl.compileShader(vertex);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fragment, FRAGMENT_MINIMAL);
    gl.compileShader(fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 9, "a_uv");
    gl.bindAttribLocation(program, 3, "a_pos"); // layout(location = 6) must win
    gl.linkProgram(program);
    expect(gl.getAttribLocation(program, "a_pos")).toBe(6);
    expect(gl.getAttribLocation(program, "a_uv")).toBe(9);
    expect(gl.getAttribLocation(program, "a_missing")).toBe(-1);
  });

  it("answers getUniformLocation under the name, name[0], and name[k] spellings for arrays", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    const bare = gl.getUniformLocation(program, "u_lights");
    const zero = gl.getUniformLocation(program, "u_lights[0]");
    const two = gl.getUniformLocation(program, "u_lights[2]");
    expect(bare).not.toBeNull();
    expect(zero).toBe(bare);
    expect(two).not.toBeNull();
    expect(two).not.toBe(bare);
    expect(gl.getUniformLocation(program, "u_lights[4]")).toBeNull();
    expect(gl.getUniformLocation(program, "u_nothing")).toBeNull();
  });

  it("introspects uniforms and attributes as WebGLActiveInfo-shaped records", () => {
    const gl = makeGl();
    const program = buildProgram(
      gl,
      "#version 300 es\nlayout(location = 1) in vec2 a_uv;\nuniform vec4 u_lights[4];\nvoid main() { gl_Position = u_lights[0] + vec4(a_uv, 0.0, 1.0); }",
      FRAGMENT_MINIMAL,
    );
    expect(gl.getActiveUniform(program, 0)).toEqual({
      name: "u_lights[0]",
      size: 4,
      type: gl.FLOAT_VEC4,
    });
    expect(gl.getActiveAttrib(program, 0)).toEqual({
      name: "a_uv",
      size: 1,
      type: gl.FLOAT_VEC2,
    });
    expect(gl.getActiveUniform(program, 1)).toBeNull();
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect(gl.getActiveAttrib(program, 5)).toBeNull();
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("resets every uniform to zero on a successful re-link, per GL", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const count = gl.getUniformLocation(program, "u_count")!;
    gl.uniform1i(count, 3);
    expect(gl.getUniform(program, count)).toBe(3);
    gl.linkProgram(program);
    const fresh = gl.getUniformLocation(program, "u_count")!;
    expect(gl.getUniform(program, fresh)).toBe(0);
  });

  it("refuses a location minted before a re-link with INVALID_OPERATION", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const stale = gl.getUniformLocation(program, "u_count")!;
    gl.linkProgram(program);
    gl.useProgram(program);
    gl.uniform1i(stale, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    // The stale location must not have written into the re-minted store.
    expect(
      gl.getUniform(program, gl.getUniformLocation(program, "u_count")!),
    ).toBe(0);
  });
});

/* ---------------------------------------------------------------------- */
/* Uniform setters                                                        */
/* ---------------------------------------------------------------------- */

describe("uniform setters", () => {
  it("writes scalars and vectors through the direct f/i forms and reads them back", () => {
    const gl = makeGl();
    const program = buildProgram(
      gl,
      VERTEX_MINIMAL,
      `#version 300 es
      uniform float u_f; uniform vec2 u_v2; uniform vec3 u_v3; uniform vec4 u_v4;
      uniform int u_i; uniform ivec3 u_iv3; uniform bool u_b; uniform bvec2 u_bv2;
      out vec4 o_color;
      void main() { o_color = vec4(u_f + u_v2.x + u_v3.x + u_v4.x + float(u_i) + float(u_iv3.x)) + vec4(u_b ? 1.0 : 0.0, u_bv2.x ? 1.0 : 0.0, 0.0, 0.0); }`,
    );
    gl.useProgram(program);
    const at = (name: string) => gl.getUniformLocation(program, name)!;
    gl.uniform1f(at("u_f"), 0.5);
    gl.uniform2f(at("u_v2"), 1, 2);
    gl.uniform3f(at("u_v3"), 3, 4, 5);
    gl.uniform4f(at("u_v4"), 6, 7, 8, 9);
    gl.uniform1i(at("u_i"), -3);
    gl.uniform3i(at("u_iv3"), 10, 11, 12);
    gl.uniform1i(at("u_b"), 1);
    gl.uniform2i(at("u_bv2"), 0, 7);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(gl.getUniform(program, at("u_f"))).toBe(0.5);
    expect(gl.getUniform(program, at("u_v2"))).toEqual(
      Float32Array.from([1, 2]),
    );
    expect(gl.getUniform(program, at("u_v3"))).toEqual(
      Float32Array.from([3, 4, 5]),
    );
    expect(gl.getUniform(program, at("u_v4"))).toEqual(
      Float32Array.from([6, 7, 8, 9]),
    );
    expect(gl.getUniform(program, at("u_i"))).toBe(-3);
    expect(gl.getUniform(program, at("u_iv3"))).toEqual(
      Int32Array.from([10, 11, 12]),
    );
    // Bool uniforms read back as booleans, normalized from the 0/1 store.
    expect(gl.getUniform(program, at("u_b"))).toBe(true);
    expect(gl.getUniform(program, at("u_bv2"))).toEqual([false, true]);
  });

  it("accepts both setter families for bool uniforms, the GL allowance", () => {
    const gl = makeGl();
    const program = buildProgram(
      gl,
      VERTEX_MINIMAL,
      "#version 300 es\nuniform bool u_b;\nout vec4 o_color;\nvoid main() { o_color = vec4(u_b ? 1.0 : 0.0); }",
    );
    gl.useProgram(program);
    const location = gl.getUniformLocation(program, "u_b")!;
    gl.uniform1f(location, 2.5);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(gl.getUniform(program, location)).toBe(true);
    gl.uniform1i(location, 0);
    expect(gl.getUniform(program, location)).toBe(false);
  });

  it("writes matrices column-major and reorders row-major data under transpose", () => {
    const gl = makeGl();
    const program = buildProgram(
      gl,
      "#version 300 es\nuniform mat4 u_m4;\nuniform mat3 u_m3;\nvoid main() { gl_Position = u_m4 * vec4(u_m3 * vec3(1.0), 1.0); }",
      FRAGMENT_MINIMAL,
    );
    gl.useProgram(program);
    const m4 = gl.getUniformLocation(program, "u_m4")!;
    const m3 = gl.getUniformLocation(program, "u_m3")!;
    const sixteen = Array.from({ length: 16 }, (_, i) => i);
    gl.uniformMatrix4fv(m4, false, sixteen);
    expect(gl.getUniform(program, m4)).toEqual(Float32Array.from(sixteen));
    // transpose=true delivers rows; the store must still read column-major.
    gl.uniformMatrix3fv(m3, true, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(gl.getUniform(program, m3)).toEqual(
      Float32Array.from([1, 4, 7, 2, 5, 8, 3, 6, 9]),
    );
  });

  it("fills a whole uniform array from the base location with one 4fv call", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const lights = gl.getUniformLocation(program, "u_lights")!;
    const data = Array.from({ length: 16 }, (_, i) => i + 1);
    gl.uniform4fv(lights, data);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(
      gl.getUniform(program, gl.getUniformLocation(program, "u_lights[0]")!),
    ).toEqual(Float32Array.from([1, 2, 3, 4]));
    expect(
      gl.getUniform(program, gl.getUniformLocation(program, "u_lights[3]")!),
    ).toEqual(Float32Array.from([13, 14, 15, 16]));
  });

  it("fills from a mid-array element location and ignores data past the array's end", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const fromTwo = gl.getUniformLocation(program, "u_lights[2]")!;
    // Three elements offered, two slots remaining: the third is ignored, per GL.
    gl.uniform4fv(fromTwo, [1, 1, 1, 1, 2, 2, 2, 2, 9, 9, 9, 9]);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(
      gl.getUniform(program, gl.getUniformLocation(program, "u_lights[2]")!),
    ).toEqual(Float32Array.from([1, 1, 1, 1]));
    expect(
      gl.getUniform(program, gl.getUniformLocation(program, "u_lights[3]")!),
    ).toEqual(Float32Array.from([2, 2, 2, 2]));
    // The elements before the starting one stayed zero.
    expect(
      gl.getUniform(program, gl.getUniformLocation(program, "u_lights[0]")!),
    ).toEqual(Float32Array.from([0, 0, 0, 0]));
  });

  it("honors the WebGL2 srcOffset and srcLength window on the *v forms", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const count = gl.getUniformLocation(program, "u_count")!;
    gl.uniform1iv(count, Int32Array.from([9, 9, 42, 9]), 2, 1);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(gl.getUniform(program, count)).toBe(42);
    // A window past the data's end is INVALID_VALUE with nothing written.
    gl.uniform1iv(count, Int32Array.from([1, 2]), 1, 5);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect(gl.getUniform(program, count)).toBe(42);
  });

  it("routes a sampler through uniform1i and refuses uniform1f on it", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const map = gl.getUniformLocation(program, "u_map")!;
    gl.uniform1f(map, 2);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.uniform1i(map, 2);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(gl.getUniform(program, map)).toBe(2);
  });

  it("refuses the wrong family and the wrong component count with INVALID_OPERATION", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const count = gl.getUniformLocation(program, "u_count")!;
    const lights = gl.getUniformLocation(program, "u_lights")!;
    gl.uniform1f(count, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.uniform2i(count, 1, 2);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.uniform3fv(lights, [1, 2, 3]);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.uniformMatrix3fv(
      lights,
      false,
      Array.from({ length: 9 }, () => 0),
    );
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses several elements aimed at a non-array location, and a length off the component grid", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    const count = gl.getUniformLocation(program, "u_count")!;
    gl.uniform1iv(count, [1, 2]);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    const lights = gl.getUniformLocation(program, "u_lights")!;
    gl.uniform4fv(lights, [1, 2, 3, 4, 5]);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("treats a null location as a silent no-op and a wrong current program as INVALID_OPERATION", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    const other = buildProgram(gl, VERTEX_MINIMAL, FRAGMENT_MINIMAL);
    const count = gl.getUniformLocation(program, "u_count")!;

    gl.useProgram(program);
    gl.uniform1f(null, 1);
    gl.uniform4fv(null, [1, 2, 3, 4]);
    gl.uniformMatrix4fv(
      null,
      false,
      Array.from({ length: 16 }, () => 0),
    );
    expect(gl.getError()).toBe(gl.NO_ERROR);

    gl.useProgram(other);
    gl.uniform1i(count, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);

    gl.useProgram(null);
    gl.uniform1i(count, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });
});

/* ---------------------------------------------------------------------- */
/* The executable seam                                                    */
/* ---------------------------------------------------------------------- */

describe("the executable the rasterizer will run", () => {
  it("feeds API-set uniforms straight into the linked fragment function", () => {
    const gl = makeGl();
    const program = buildLightsProgram(gl);
    gl.useProgram(program);
    gl.uniform4fv(
      gl.getUniformLocation(program, "u_lights")!,
      [0.25, 0, 0, 1, 0, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    );
    gl.uniform1i(gl.getUniformLocation(program, "u_count")!, 2);
    gl.uniform1i(gl.getUniformLocation(program, "u_map")!, 0);

    const executable = program.executable!;
    const out = new Float64Array(4);
    const discarded = executable.fragment(
      new Float64Array(executable.varyingComponents),
      program.uniformStore!,
      [() => [0, 0, 0, 0]],
      Float64Array.from([0, 0, 0, 1]),
      true,
      out,
    );
    expect(discarded).toBe(false);
    // The two counted lights sum; the third slot and the zero sampler add nothing.
    expect([...out]).toEqual([0.25, 0.5, 0, 1]);
  });

  it("runs the vertex function over the layout getAttribLocation reports", () => {
    const gl = makeGl();
    const program = buildProgram(
      gl,
      "#version 300 es\nin vec2 a_offset;\nuniform mat4 u_mvp;\nvoid main() { gl_Position = u_mvp * vec4(a_offset, 0.0, 1.0); }",
      FRAGMENT_MINIMAL,
    );
    gl.useProgram(program);
    gl.uniformMatrix4fv(
      gl.getUniformLocation(program, "u_mvp")!,
      false,
      [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 1, 0, 1],
    );

    const location = gl.getAttribLocation(program, "a_offset");
    const attributes = new Float64Array(16 * 4);
    attributes.set([3, 5], location * 4);
    const executable = program.executable!;
    const position = new Float64Array(4);
    executable.vertex(
      attributes,
      program.uniformStore!,
      [],
      new Float64Array(executable.varyingComponents),
      position,
    );
    expect([...position]).toEqual([7, 11, 0, 1]);
  });
});
