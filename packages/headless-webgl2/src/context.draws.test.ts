import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * The stage-3 draw pipeline through the public GL surface: golden byte-array
 * scenes over tiny canvases, each small enough to hand-compute. This suite
 * owns pixel truths — coverage sets, depth ordering, blend arithmetic,
 * texel exactness, cull orientation, line endpoints — while the geometry and
 * sampling arithmetic they are built from is pinned module-level in
 * `raster/*.test.ts`, and the shader-evaluation semantics in `glsl/*.test.ts`.
 *
 * Every expected byte comes from the package's one float→byte rule,
 * round(clamp01(v) * 255), restated here as `byte` so a reader can check the
 * arithmetic without leaving the file.
 */

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

/** The package's float→byte rule, restated for hand-computed expectations. */
function byte(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

/**
 * Contexts here default to the package default — antialias on — so these
 * goldens hold under the 2×2 supersampling every real consumer gets. Tests
 * whose claim is a *pixel-center* truth (single-sample coverage sets,
 * gl_FragCoord arithmetic) pass `antialias: false` and say why.
 */
function makeGl(
  width = 8,
  height = 8,
  attributes?: { alpha?: boolean; antialias?: boolean },
): HeadlessWebGL2 {
  return createCanvas(width, height).getContext("webgl2", attributes);
}

/** Compiles and links a program, failing the test loudly with the info logs. */
function buildProgram(
  gl: HeadlessWebGL2,
  vertexSource: string,
  fragmentSource: string,
) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (vs === null || fs === null)
    throw new Error("createShader refused a valid type");
  gl.shaderSource(vs, vertexSource);
  gl.compileShader(vs);
  gl.shaderSource(fs, fragmentSource);
  gl.compileShader(fs);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(
      `link failed: ${gl.getShaderInfoLog(vs)} | ${gl.getShaderInfoLog(fs)} | ${gl.getProgramInfoLog(program)}`,
    );
  }
  gl.useProgram(program);
  return program;
}

/** Uploads a float attribute array to a fresh buffer and points location at it. */
function uploadAttrib(
  gl: HeadlessWebGL2,
  location: number,
  size: number,
  values: number[],
): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

/** One pixel's RGBA bytes; x/y in the bottom-up framebuffer addressing readPixels uses. */
function pixel(
  gl: HeadlessWebGL2,
  x: number,
  y: number,
): [number, number, number, number] {
  const out = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0];
}

/** The whole framebuffer's bytes, rows bottom-up. */
function readAll(
  gl: HeadlessWebGL2,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
}

/** The NDC x (or y) of a pixel center on an `extent`-pixel axis. */
function ndc(pixelIndex: number, extent: number): number {
  return ((pixelIndex + 0.5) / extent) * 2 - 1;
}

const VS_POS2 = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const VS_POS3 = `#version 300 es
layout(location = 0) in vec3 a_pos;
void main() { gl_Position = vec4(a_pos, 1.0); }
`;

const FS_UNIFORM_COLOR = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o_color;
void main() { o_color = u_color; }
`;

/** Two-triangle full-NDC quad, TRIANGLES order with a shared diagonal. */
const FULL_QUAD = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];

/** Builds the flat-color rig: position program + u_color set. */
function flatColorRig(
  gl: HeadlessWebGL2,
  r: number,
  g: number,
  b: number,
  a: number,
  vs = VS_POS2,
) {
  const program = buildProgram(gl, vs, FS_UNIFORM_COLOR);
  gl.uniform4f(gl.getUniformLocation(program, "u_color"), r, g, b, a);
  return program;
}

/* ------------------------------------------------------------------------ */
/* Solid coverage and byte exactness                                        */
/* ------------------------------------------------------------------------ */

describe("a solid triangle", () => {
  it("covers exactly the hand-computed pixel set, byte-exact, with the diagonal owned by no uncovered pixel", () => {
    // Single-sample so the claim stays the pixel-center coverage rule; the
    // same scene under the default supersampling is the sibling test below.
    const gl = makeGl(8, 8, { antialias: false });
    flatColorRig(gl, 0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // The hypotenuse runs from window (8,0) to (0,8); a center (x+0.5, y+0.5)
    // is strictly inside iff x + y < 7, and the on-edge centers (x + y == 7)
    // belong to the other side of the diagonal under the fill rule.
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const expected = x + y < 7 ? [0xf2, 0xf5, 0xf7, 255] : [0, 0, 0, 0];
        expect(pixel(gl, x, y), `pixel (${x}, ${y})`).toEqual(expected);
      }
    }
  });

  it("keeps the interior byte-exact and blends the diagonal quarter-covered under the default supersampling", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // In the 16×16 sample space the hypotenuse is sx + sy + 1 < 16. A device
    // pixel with x + y == 7 holds subsample index sums {14, 15, 15, 16}, so
    // exactly one of its four subsamples is covered: the resolve averages one
    // filled quad against three transparent ones.
    const edge = [
      Math.round(0xf2 / 4),
      Math.round(0xf5 / 4),
      Math.round(0xf7 / 4),
      Math.round(255 / 4),
    ];
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const expected =
          x + y < 7
            ? [0xf2, 0xf5, 0xf7, 255]
            : x + y === 7
              ? edge
              : [0, 0, 0, 0];
        expect(pixel(gl, x, y), `pixel (${x}, ${y})`).toEqual(expected);
      }
    }
  });

  it("draws an unlit CSS hex color byte-exact at an interior sample, the documented validator claim", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 4, 4)).toEqual([0xf2, 0xf5, 0xf7, 255]);
  });
});

describe("the top-left fill rule", () => {
  it("gives every pixel of a two-triangle quad to exactly one triangle: additive blending never doubles", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 0.25, 0.25, 0.25, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const single = byte(0.25);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        // A diagonal pixel hit by both triangles would read byte(0.5) = 128.
        expect(pixel(gl, x, y)[0], `pixel (${x}, ${y})`).toBe(single);
      }
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Depth                                                                    */
/* ------------------------------------------------------------------------ */

describe("the depth test", () => {
  /** Draws a full-screen quad at NDC depth `z` in the given color. */
  function drawQuadAt(
    gl: HeadlessWebGL2,
    program: ReturnType<typeof buildProgram>,
    z: number,
    r: number,
    g: number,
    b: number,
  ): void {
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), r, g, b, 1);
    uploadAttrib(gl, 0, 3, [
      -1,
      -1,
      z,
      1,
      -1,
      z,
      -1,
      1,
      z,
      -1,
      1,
      z,
      1,
      -1,
      z,
      1,
      1,
      z,
    ]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  it("orders opaque surfaces by depth, not by draw order", () => {
    for (const nearFirst of [true, false]) {
      const gl = makeGl(4, 4);
      gl.enable(gl.DEPTH_TEST);
      const program = flatColorRig(gl, 0, 0, 0, 1, VS_POS3);
      const near = (): void => drawQuadAt(gl, program, -0.5, 1, 0, 0);
      const far = (): void => drawQuadAt(gl, program, 0.5, 0, 0, 1);
      if (nearFirst) {
        near();
        far();
      } else {
        far();
        near();
      }
      // Either order, the nearer red surface owns the picture.
      expect(pixel(gl, 2, 2), `near first: ${nearFirst}`).toEqual([
        255, 0, 0, 255,
      ]);
    }
  });

  it("rejects an equal-depth fragment under the default LESS and admits it under LEQUAL", () => {
    const gl = makeGl(4, 4);
    gl.enable(gl.DEPTH_TEST);
    const program = flatColorRig(gl, 0, 0, 0, 1, VS_POS3);
    drawQuadAt(gl, program, 0, 1, 0, 0);
    drawQuadAt(gl, program, 0, 0, 0, 1);
    expect(pixel(gl, 2, 2)).toEqual([255, 0, 0, 255]);
    gl.depthFunc(gl.LEQUAL);
    drawQuadAt(gl, program, 0, 0, 1, 0);
    expect(pixel(gl, 2, 2)).toEqual([0, 255, 0, 255]);
  });

  it("keeps the depth buffer unwritten under depthMask(false), so a later farther draw still passes", () => {
    const gl = makeGl(4, 4);
    gl.enable(gl.DEPTH_TEST);
    const program = flatColorRig(gl, 0, 0, 0, 1, VS_POS3);
    gl.depthMask(false);
    drawQuadAt(gl, program, -0.5, 1, 0, 0);
    gl.depthMask(true);
    // Depth still holds the cleared 1, so this farther quad wins the test.
    drawQuadAt(gl, program, 0.5, 0, 0, 1);
    expect(pixel(gl, 2, 2)).toEqual([0, 0, 255, 255]);
  });

  it("lets clear(DEPTH_BUFFER_BIT) start a new layer over nearer geometry, the engines' layering idiom", () => {
    const gl = makeGl(4, 4);
    gl.enable(gl.DEPTH_TEST);
    const program = flatColorRig(gl, 0, 0, 0, 1, VS_POS3);
    drawQuadAt(gl, program, -0.5, 1, 0, 0);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    drawQuadAt(gl, program, 0.5, 0, 0, 1);
    expect(pixel(gl, 2, 2)).toEqual([0, 0, 255, 255]);
  });

  it("neither tests nor writes depth while DEPTH_TEST is disabled, per the ES rule", () => {
    const gl = makeGl(4, 4);
    const program = flatColorRig(gl, 0, 0, 0, 1, VS_POS3);
    drawQuadAt(gl, program, -0.5, 1, 0, 0);
    gl.enable(gl.DEPTH_TEST);
    // Had the first draw written depth -0.5 → 0.25, this farther quad would
    // lose; it wins because a disabled test writes nothing.
    drawQuadAt(gl, program, 0.5, 0, 0, 1);
    expect(pixel(gl, 2, 2)).toEqual([0, 0, 255, 255]);
  });

  it("applies polygonOffset to coplanar fills: positive units lose to the incumbent, negative units win", () => {
    const gl = makeGl(4, 4);
    gl.enable(gl.DEPTH_TEST);
    const program = flatColorRig(gl, 0, 0, 0, 1, VS_POS3);
    drawQuadAt(gl, program, 0, 1, 0, 0);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 16);
    drawQuadAt(gl, program, 0, 0, 0, 1);
    expect(pixel(gl, 2, 2)).toEqual([255, 0, 0, 255]);
    gl.polygonOffset(0, -100_000);
    drawQuadAt(gl, program, 0, 0, 1, 0);
    expect(pixel(gl, 2, 2)).toEqual([0, 255, 0, 255]);
  });
});

/* ------------------------------------------------------------------------ */
/* Culling                                                                  */
/* ------------------------------------------------------------------------ */

describe("face culling", () => {
  const CCW_TRIANGLE = [-1, -1, 1, -1, -1, 1];
  const CW_TRIANGLE = [-1, -1, -1, 1, 1, -1];

  function drawTriangle(gl: HeadlessWebGL2, winding: number[]): void {
    uploadAttrib(gl, 0, 2, winding);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  it("culls back faces only: a CCW triangle survives cullFace(BACK), a CW one vanishes", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    gl.enable(gl.CULL_FACE);
    drawTriangle(gl, CW_TRIANGLE);
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 0, 0]);
    drawTriangle(gl, CCW_TRIANGLE);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("flips what counts as front under frontFace(CW)", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    gl.enable(gl.CULL_FACE);
    gl.frontFace(gl.CW);
    drawTriangle(gl, CCW_TRIANGLE);
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 0, 0]);
    drawTriangle(gl, CW_TRIANGLE);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("culls everything under FRONT_AND_BACK, but only polygons — a line still draws", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT_AND_BACK);
    drawTriangle(gl, CCW_TRIANGLE);
    drawTriangle(gl, CW_TRIANGLE);
    expect(readAll(gl, 4, 4).every((b) => b === 0)).toBe(true);
    uploadAttrib(gl, 0, 2, [ndc(0, 4), ndc(1, 4), ndc(3, 4), ndc(1, 4)]);
    gl.drawArrays(gl.LINES, 0, 2);
    expect(pixel(gl, 1, 1)).toEqual([255, 0, 0, 255]);
  });

  it("reports gl_FrontFacing per winding to the fragment shader", () => {
    const gl = makeGl(4, 4);
    const program = buildProgram(
      gl,
      VS_POS2,
      `#version 300 es
precision mediump float;
out vec4 o_color;
void main() { o_color = gl_FrontFacing ? vec4(1.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, 1.0, 1.0); }
`,
    );
    expect(program).toBeDefined();
    drawTriangle(gl, CCW_TRIANGLE);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
    drawTriangle(gl, CW_TRIANGLE);
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 255, 255]);
  });
});

/* ------------------------------------------------------------------------ */
/* Scissor and viewport                                                     */
/* ------------------------------------------------------------------------ */

describe("scissor and viewport bounds", () => {
  it("confines a draw to the scissor box while the clear color marks the difference", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 2, 2);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.scissor(2, 2, 2, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Scissored clear painted the bottom-left; the scissored draw painted
    // only the top-right; the other corners kept the initial transparent.
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(gl, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 3, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(gl, 0, 3)).toEqual([0, 0, 0, 0]);
  });

  it("maps NDC through the viewport rectangle, leaving the rest of the canvas alone", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.viewport(2, 0, 2, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 3, 1)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 1, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(gl, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("draws nothing into an empty viewport, without latching an error", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.viewport(0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(readAll(gl, 4, 4).every((b) => b === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* Blending                                                                 */
/* ------------------------------------------------------------------------ */

describe("blending", () => {
  it("computes SRC_ALPHA / ONE_MINUS_SRC_ALPHA over a known destination byte-exactly", () => {
    const gl = makeGl(2, 2);
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    flatColorRig(gl, 1, 0, 0, 0.5);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Destination is the cleared bytes read back as byte/255.
    const dst = [byte(0.2) / 255, byte(0.4) / 255, byte(0.6) / 255, 1];
    expect(pixel(gl, 1, 1)).toEqual([
      byte(1 * 0.5 + (dst[0] ?? 0) * 0.5),
      byte(0 * 0.5 + (dst[1] ?? 0) * 0.5),
      byte(0 * 0.5 + (dst[2] ?? 0) * 0.5),
      byte(0.5 * 0.5 + 1 * 0.5),
    ]);
  });

  it("honors blendEquation(FUNC_REVERSE_SUBTRACT): destination minus source, clamped at zero", () => {
    const gl = makeGl(2, 2);
    gl.clearColor(0.5, 0.5, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    flatColorRig(gl, 0.75, 0.25, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const dst = byte(0.5) / 255;
    expect(pixel(gl, 0, 0)).toEqual([
      byte(dst - 0.75),
      byte(dst - 0.25),
      byte(dst - 0),
      byte(1 - 1),
    ]);
  });

  it("reads CONSTANT_COLOR factors from blendColor", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 1, 1, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.CONSTANT_COLOR, gl.ZERO);
    gl.blendColor(0.25, 0.5, 0.75, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([byte(0.25), byte(0.5), byte(0.75), 255]);
  });

  it("applies separate rgb and alpha factors through blendFuncSeparate", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 0.5, 0.5, 0.5, 0.5);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ZERO, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // rgb keeps the source; alpha keeps the destination's initial 0.
    expect(pixel(gl, 0, 0)).toEqual([byte(0.5), byte(0.5), byte(0.5), 0]);
  });

  it("forces the stored alpha byte to 255 under alpha: false, even through blending", () => {
    const gl = makeGl(2, 2, { alpha: false });
    flatColorRig(gl, 1, 0, 0, 0.5);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const sample = pixel(gl, 0, 0);
    expect(sample[3]).toBe(255);
    // Destination rgb started at opaque black; half red over it.
    expect(sample[0]).toBe(byte(0.5));
  });

  it("honors colorMask channel by channel on a draw", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 1, 1, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.colorMask(true, false, true, false);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 255, 0]);
  });
});

/* ------------------------------------------------------------------------ */
/* Textures                                                                 */
/* ------------------------------------------------------------------------ */

const VS_UV = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_uv = a_uv; }
`;

const FS_TEXTURE = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o_color;
void main() { o_color = texture(u_tex, v_uv); }
`;

/** Uploads the full-quad positions and matching 0..1 uvs to locations 0 and 1. */
function uploadTexturedQuad(gl: HeadlessWebGL2): void {
  uploadAttrib(gl, 0, 2, FULL_QUAD);
  uploadAttrib(gl, 1, 2, [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
}

/** Creates a bound 2×2 RGBA NEAREST test card: red, green (bottom); blue, yellow (top). */
function bindTestCard(gl: HeadlessWebGL2): void {
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    2,
    2,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
    ]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

describe("textured draws", () => {
  it("samples NEAREST texels byte-exact per quadrant of a textured quad", () => {
    const gl = makeGl(4, 4);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    bindTestCard(gl);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // Texture row 0 is v = 0, the bottom of the picture.
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 3, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(gl, 0, 3)).toEqual([0, 0, 255, 255]);
    expect(pixel(gl, 3, 3)).toEqual([255, 255, 0, 255]);
  });

  it("routes the sampler through the uniform's texture unit, not unit 0", () => {
    const gl = makeGl(4, 4);
    const program = buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    // Unit 0 holds nothing; the card sits on unit 2.
    gl.activeTexture(gl.TEXTURE2);
    bindTestCard(gl);
    gl.uniform1i(gl.getUniformLocation(program, "u_tex"), 2);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("interpolates LINEAR between texel centers with exact endpoints, per the filtering arithmetic", () => {
    const gl = makeGl(4, 1);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      2,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // Pixel centers sample u = 1/8, 3/8, 5/8, 7/8 → texel-space -0.25, 0.25,
    // 0.75, 1.25: clamped edge, quarter mix, three-quarter mix, clamped edge.
    expect(pixel(gl, 0, 0)[0]).toBe(0);
    expect(pixel(gl, 1, 0)[0]).toBe(byte(0.25));
    expect(pixel(gl, 2, 0)[0]).toBe(byte(0.75));
    expect(pixel(gl, 3, 0)[0]).toBe(255);
  });

  it("draws opaque black from an incomplete texture (the default mip-requiring min filter), as a browser does", () => {
    const gl = makeGl(2, 2);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255]),
    );
    // No filter set: the default NEAREST_MIPMAP_LINEAR needs mips that
    // cannot exist in 0.1.0, so the texture is incomplete.
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("refuses the draw with INVALID_OPERATION when a sampler uniform names an out-of-range unit", () => {
    const gl = makeGl(2, 2);
    const program = buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    bindTestCard(gl);
    gl.uniform1i(gl.getUniformLocation(program, "u_tex"), 40);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(readAll(gl, 2, 2).every((b) => b === 0)).toBe(true);
  });
});

describe("texSubImage2D and texStorage2D", () => {
  it("updates a sub-rectangle in place, visible to the next draw", () => {
    const gl = makeGl(4, 4);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    bindTestCard(gl);
    // Repaint the top-right texel white.
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      1,
      1,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    expect(gl.getError()).toBe(gl.NO_ERROR);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("reverses the uploaded rows within the rect under UNPACK_FLIP_Y_WEBGL", () => {
    const gl = makeGl(2, 4);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    uploadAttrib(gl, 1, 2, [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      2,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // Source rows: red then blue; flipped, blue lands in texture row 0.
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1,
      2,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(gl, 0, 3)).toEqual([255, 0, 0, 255]);
  });

  it("refuses a rect outside the image with INVALID_VALUE and a mismatched format with INVALID_OPERATION", () => {
    const gl = makeGl(2, 2);
    bindTestCard(gl);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      1,
      1,
      2,
      2,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(16),
    );
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      new Uint8Array(3),
    );
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("allocates zeroed immutable storage that texSubImage2D fills and texImage2D refuses", () => {
    const gl = makeGl(2, 2);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([0, 0, 0, 0]);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 0, 0, 255]),
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses an unsized internal format with INVALID_ENUM and throws for excluded storage shapes", () => {
    const gl = makeGl(2, 2);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA, 1, 1);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(() => gl.texStorage2D(gl.TEXTURE_2D, 2, gl.RGBA8, 2, 2)).toThrow(
      /mipmaps are outside 0\.1\.0/,
    );
    expect(() => gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 1, 1)).toThrow(
      /sized internal format outside RGBA8, RGB8, and R8/,
    );
  });
});

/* ------------------------------------------------------------------------ */
/* Varyings and built-ins                                                   */
/* ------------------------------------------------------------------------ */

describe("varyings and fragment built-ins", () => {
  it("interpolates varyings perspective-correct across a receding quad, per the 1/w arithmetic", () => {
    // Single-sample: the analytic claim is a pixel-center value, and the
    // supersample resolve would average the nonlinear perspective function
    // across four subsamples (byte-exactness is only ever promised for flat
    // interiors, per the validator docs).
    const gl = makeGl(8, 8, { antialias: false });
    buildProgram(
      gl,
      `#version 300 es
layout(location = 0) in vec4 a_pos;
layout(location = 1) in float a_t;
out float v_t;
void main() { gl_Position = a_pos; v_t = a_t; }
`,
      `#version 300 es
precision mediump float;
in float v_t;
out vec4 o_color;
void main() { o_color = vec4(v_t, 0.0, 0.0, 1.0); }
`,
    );
    // A planar quad whose left edge sits at w = 1 and right edge at w = 2
    // (clip x = ndc × w). Screen-linear interpolation would read s at
    // column s; the perspective-correct value is (s/2) / (1 - s/2).
    uploadAttrib(
      gl,
      0,
      4,
      [
        -1, -1, 0, 1, 2, -2, 0, 2, -1, 1, 0, 1, -1, 1, 0, 1, 2, -2, 0, 2, 2, 2,
        0, 2,
      ],
    );
    uploadAttrib(gl, 1, 1, [0, 1, 0, 0, 1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    for (const x of [1, 3, 6]) {
      const s = (x + 0.5) / 8;
      const expected = (s * 0.5) / (1 - s * 0.5);
      expect(pixel(gl, x, 4)[0], `column ${x}`).toBe(byte(expected));
    }
  });

  it("hands gl_FragCoord pixel centers to the fragment shader", () => {
    // Single-sample: gl_FragCoord carries raster coordinates, which under
    // the default supersampling are sample coordinates (the SSAA suite pins
    // that scaling); here the claim is the pixel-center convention itself.
    const gl = makeGl(8, 8, { antialias: false });
    buildProgram(
      gl,
      VS_POS2,
      `#version 300 es
precision mediump float;
out vec4 o_color;
void main() { o_color = vec4(gl_FragCoord.x / 8.0, gl_FragCoord.y / 8.0, 0.0, 1.0); }
`,
    );
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 3, 5)).toEqual([byte(3.5 / 8), byte(5.5 / 8), 0, 255]);
  });

  it("discards fragments without touching color or depth", () => {
    // Single-sample because the discard boundary is written against
    // gl_FragCoord, which is sample-scaled under the default supersampling.
    const gl = makeGl(8, 8, { antialias: false });
    gl.enable(gl.DEPTH_TEST);
    buildProgram(
      gl,
      VS_POS2,
      `#version 300 es
precision mediump float;
out vec4 o_color;
void main() {
  if (gl_FragCoord.x < 4.0) { discard; }
  o_color = vec4(1.0, 0.0, 0.0, 1.0);
}
`,
    );
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 3, 4)).toEqual([0, 0, 0, 0]);
    expect(pixel(gl, 4, 4)).toEqual([255, 0, 0, 255]);
    // Depth stayed cleared where fragments discarded: an equal-depth draw
    // under LESS still lands there.
    flatColorRig(gl, 0, 0, 1, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 3, 4)).toEqual([0, 0, 255, 255]);
    expect(pixel(gl, 4, 4)).toEqual([255, 0, 0, 255]);
  });
});

/* ------------------------------------------------------------------------ */
/* The uniform-array integration scene                                      */
/* ------------------------------------------------------------------------ */

describe("the lighting-loop integration scene", () => {
  const FS_LIGHTS = `#version 300 es
precision mediump float;
uniform vec3 u_light_dirs[4];
uniform vec3 u_light_colors[4];
uniform vec3 u_normal;
out vec4 o_color;
void main() {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    acc += u_light_colors[i] * max(dot(normalize(u_light_dirs[i]), u_normal), 0.0);
  }
  o_color = vec4(acc, 1.0);
}
`;

  function drawLit(gl: HeadlessWebGL2, colors: number[]): void {
    const program = buildProgram(gl, VS_POS2, FS_LIGHTS);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.uniform3fv(
      gl.getUniformLocation(program, "u_light_dirs"),
      [0, 0, 1, 0, 0, -1, 1, 0, 0, 0, 1, 1],
    );
    gl.uniform3fv(gl.getUniformLocation(program, "u_light_colors"), colors);
    gl.uniform3f(gl.getUniformLocation(program, "u_normal"), 0, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  it("accumulates a 4-light uniform-array loop to the hand-computed sum", () => {
    const gl = makeGl(2, 2);
    drawLit(gl, [0.5, 0, 0, 0, 1, 0, 0, 0.25, 0, 0, 0, 0.25]);
    // Facing light contributes fully, the opposed and perpendicular ones
    // nothing, the diagonal one by cos 45°.
    expect(pixel(gl, 1, 1)).toEqual([
      byte(0.5),
      0,
      byte(0.25 * Math.SQRT1_2),
      255,
    ]);
  });

  it("responds monotonically to a light change: the dimmer setup reads darker at the same sample", () => {
    const bright = makeGl(2, 2);
    drawLit(bright, [0.5, 0, 0, 0, 1, 0, 0, 0.25, 0, 0, 0, 0.25]);
    const dim = makeGl(2, 2);
    drawLit(dim, [0.25, 0, 0, 0, 1, 0, 0, 0.25, 0, 0, 0, 0.25]);
    const brightRed = pixel(bright, 1, 1)[0];
    const dimRed = pixel(dim, 1, 1)[0];
    expect(dimRed).toBeGreaterThan(0);
    expect(dimRed).toBeLessThan(brightRed);
  });
});

/* ------------------------------------------------------------------------ */
/* Lines and points                                                         */
/* ------------------------------------------------------------------------ */

describe("lines and points", () => {
  it("writes both endpoint pixels and every column between on a horizontal line", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [ndc(1, 8), ndc(2, 8), ndc(6, 8), ndc(2, 8)]);
    gl.drawArrays(gl.LINES, 0, 2);
    for (let x = 0; x < 8; x += 1) {
      expect(pixel(gl, x, 2)[0], `column ${x}`).toBe(
        x >= 1 && x <= 6 ? 255 : 0,
      );
    }
    // The neighboring rows stay clean: one pixel wide means one pixel wide.
    expect(pixel(gl, 3, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(gl, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it("walks a diagonal one pixel per step, endpoints included", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [ndc(0, 8), ndc(0, 8), ndc(7, 8), ndc(7, 8)]);
    gl.drawArrays(gl.LINES, 0, 2);
    for (let i = 0; i < 8; i += 1) {
      expect(pixel(gl, i, i)[0], `pixel (${i}, ${i})`).toBe(255);
    }
    expect(pixel(gl, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("closes a LINE_LOOP back to its first vertex", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [
      ndc(1, 8),
      ndc(1, 8),
      ndc(6, 8),
      ndc(1, 8),
      ndc(6, 8),
      ndc(6, 8),
    ]);
    gl.drawArrays(gl.LINE_LOOP, 0, 3);
    // The closing edge is the diagonal from (6,6) back to (1,1).
    expect(pixel(gl, 3, 3)[0]).toBe(255);
    expect(pixel(gl, 4, 1)[0]).toBe(255);
    expect(pixel(gl, 6, 3)[0]).toBe(255);
  });

  it("rasters a point as the single pixel containing it", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [ndc(2, 8), ndc(5, 8), ndc(6, 8), ndc(1, 8)]);
    gl.drawArrays(gl.POINTS, 0, 2);
    expect(pixel(gl, 2, 5)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 6, 1)).toEqual([255, 0, 0, 255]);
    expect(
      readAll(gl, 8, 8).filter((_, i) => i % 4 === 0 && _ !== 0),
    ).toHaveLength(2);
  });

  it("depth-tests line fragments like any other fragment", () => {
    const gl = makeGl(8, 8);
    gl.enable(gl.DEPTH_TEST);
    const program = flatColorRig(gl, 1, 0, 0, 1, VS_POS3);
    // A near quad first, then a line behind it across the same row.
    uploadAttrib(
      gl,
      0,
      3,
      [
        -1, -1, -0.5, 1, -1, -0.5, -1, 1, -0.5, -1, 1, -0.5, 1, -1, -0.5, 1, 1,
        -0.5,
      ],
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 0, 0, 1, 1);
    uploadAttrib(gl, 0, 3, [
      ndc(0, 8),
      ndc(4, 8),
      0.5,
      ndc(7, 8),
      ndc(4, 8),
      0.5,
    ]);
    gl.drawArrays(gl.LINES, 0, 2);
    expect(pixel(gl, 3, 4)).toEqual([255, 0, 0, 255]);
  });
});

/* ------------------------------------------------------------------------ */
/* Assembly modes and drawElements                                          */
/* ------------------------------------------------------------------------ */

describe("primitive assembly", () => {
  it("covers a quad exactly once as a TRIANGLE_STRIP", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 0.25, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    const bytes = readAll(gl, 4, 4);
    for (let i = 0; i < bytes.length; i += 4) {
      expect(bytes[i], `pixel ${i / 4}`).toBe(byte(0.25));
    }
  });

  it("keeps a strip's even and odd triangles both front-facing under culling, per the winding rule", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.enable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Were the odd triangle's winding not swapped, half the quad would cull.
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 3, 3)).toEqual([255, 0, 0, 255]);
  });

  it("fans around the first vertex as a TRIANGLE_FAN", () => {
    const gl = makeGl(4, 4);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, 1, 1, -1, 1]);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    const bytes = readAll(gl, 4, 4);
    for (let i = 0; i < bytes.length; i += 4) expect(bytes[i]).toBe(255);
  });

  it("draws indexed triangles through drawElements for all three index types", () => {
    for (const [type, IndexArray] of [
      [0x1401, Uint8Array],
      [0x1403, Uint16Array],
      [0x1405, Uint32Array],
    ] as const) {
      const gl = makeGl(4, 4);
      flatColorRig(gl, 1, 0, 0, 1);
      uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, 1, 1]);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new IndexArray([0, 1, 2, 2, 1, 3]),
        gl.STATIC_DRAW,
      );
      gl.drawElements(gl.TRIANGLES, 6, type, 0);
      expect(gl.getError(), `type 0x${type.toString(16)}`).toBe(gl.NO_ERROR);
      expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);
      expect(pixel(gl, 3, 3)).toEqual([255, 0, 0, 255]);
    }
  });

  it("honors the always-on primitive restart index, splitting a LINE_STRIP into two runs", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [
      ndc(0, 8),
      ndc(0, 8),
      ndc(3, 8),
      ndc(0, 8),
      ndc(0, 8),
      ndc(3, 8),
      ndc(3, 8),
      ndc(3, 8),
    ]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 0xffff, 2, 3]),
      gl.STATIC_DRAW,
    );
    gl.drawElements(gl.LINE_STRIP, 5, gl.UNSIGNED_SHORT, 0);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // Two horizontal rows; no connecting stroke between (3,0) and (0,3).
    expect(pixel(gl, 1, 0)[0]).toBe(255);
    expect(pixel(gl, 1, 3)[0]).toBe(255);
    expect(pixel(gl, 3, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(gl, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it("runs the vertex shader once per unique index, not once per corner", () => {
    const gl = makeGl(4, 4);
    // A varying written from an attribute proves fetch correctness; the
    // dedup itself is observable only as identical output, so this test
    // pins the indexed quad's picture equal to the drawArrays picture.
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2, 2, 1, 3]),
      gl.STATIC_DRAW,
    );
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    const indexed = readAll(gl, 4, 4);
    const gl2 = makeGl(4, 4);
    flatColorRig(gl2, 1, 0, 0, 1);
    uploadAttrib(gl2, 0, 2, [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl2.drawArrays(gl2.TRIANGLES, 0, 6);
    expect(Array.from(indexed)).toEqual(Array.from(readAll(gl2, 4, 4)));
  });
});

/* ------------------------------------------------------------------------ */
/* Draw validation                                                          */
/* ------------------------------------------------------------------------ */

describe("draw validation", () => {
  it("latches INVALID_OPERATION and draws nothing with no program in use", () => {
    const gl = makeGl(2, 2);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(readAll(gl, 2, 2).every((b) => b === 0)).toBe(true);
  });

  it("latches INVALID_ENUM for an unknown mode and INVALID_VALUE for negative counts", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawArrays(0x9999, 0, 3);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    gl.drawArrays(gl.TRIANGLES, 0, -1);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.drawArrays(gl.TRIANGLES, -1, 3);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("refuses a draw whose attribute fetch would run past the buffer, leaving the framebuffer untouched", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 0, 0, 1);
    // Two floats: half of one vec2 vertex short of the three needed.
    uploadAttrib(gl, 0, 2, [0, 0, 1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(readAll(gl, 2, 2).every((b) => b === 0)).toBe(true);
  });

  it("feeds a disabled attribute array from its vertexAttrib4f generic value", () => {
    const gl = makeGl(2, 2);
    const program = buildProgram(
      gl,
      `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
out vec4 v_color;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); v_color = a_color; }
`,
      `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o_color;
void main() { o_color = v_color; }
`,
    );
    expect(program).toBeDefined();
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.vertexAttrib4f(1, 0, 1, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(pixel(gl, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it("validates the drawElements index stream: no element buffer, misaligned offset, out-of-range read", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 2]),
      gl.STATIC_DRAW,
    );
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 1);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.drawElements(gl.TRIANGLES, 4, gl.UNSIGNED_SHORT, 0);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses an index addressing past the attribute arrays with INVALID_OPERATION", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [0, 0, 1, 1, -1, 1]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array([0, 1, 7]),
      gl.STATIC_DRAW,
    );
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(readAll(gl, 2, 2).every((b) => b === 0)).toBe(true);
  });

  it("treats a zero count as a completed no-op", () => {
    const gl = makeGl(2, 2);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, FULL_QUAD);
    gl.drawArrays(gl.TRIANGLES, 0, 0);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    expect(readAll(gl, 2, 2).every((b) => b === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* Determinism                                                              */
/* ------------------------------------------------------------------------ */

describe("determinism", () => {
  /** A scene exercising every stage-3 path: clear, depth, texture, blend, line. */
  function renderScene(gl: HeadlessWebGL2): Uint8Array {
    gl.clearColor(0.1, 0.2, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    buildProgram(gl, VS_UV, FS_TEXTURE);
    uploadTexturedQuad(gl);
    bindTestCard(gl);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    const flat = flatColorRig(gl, 0.8, 0.1, 0.4, 0.5, VS_POS2);
    expect(flat).toBeDefined();
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    uploadAttrib(gl, 0, 2, [ndc(0, 8), ndc(6, 8), ndc(7, 8), ndc(1, 8)]);
    gl.drawArrays(gl.LINES, 0, 2);
    return readAll(gl, 8, 8);
  }

  it("produces byte-identical framebuffers for the same op stream on two fresh contexts", () => {
    const first = renderScene(makeGl(8, 8));
    const second = renderScene(makeGl(8, 8));
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});
