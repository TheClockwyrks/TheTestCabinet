import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * The stage-4 antialiasing contract, through the public GL surface: under the
 * default `antialias` attribute the buffer is 2×2 supersampled, and the
 * documented sampling guidance must hold both ways — an edge pixel blends
 * between its two sides, while a pixel comfortably inside a flat surface
 * carries the surface's color byte-exact, identical to the single-sample
 * picture. Single-scene goldens (which exact bytes an edge resolves to, what
 * gl_FragCoord carries) live in `context.draws.test.ts`; this suite owns the
 * on/off *invariants*, the parts of the pipeline the subsample planes could
 * silently break (scissored clears, per-subsample depth, blending, lines),
 * and the antialiased determinism requirement.
 */

/** The package's float→byte rule, restated for hand-computed expectations. */
function byte(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
}

function makeGl(
  width: number,
  height: number,
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

const VS_POS2 = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FS_UNIFORM_COLOR = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o_color;
void main() { o_color = u_color; }
`;

/** Builds the flat-color rig: position program + u_color set. */
function flatColorRig(
  gl: HeadlessWebGL2,
  r: number,
  g: number,
  b: number,
  a: number,
) {
  const program = buildProgram(gl, VS_POS2, FS_UNIFORM_COLOR);
  gl.uniform4f(gl.getUniformLocation(program, "u_color"), r, g, b, a);
  return program;
}

/* ------------------------------------------------------------------------ */
/* The interior-exactness invariant                                         */
/* ------------------------------------------------------------------------ */

const SCENE_SIZE = 48;

/**
 * A fixed multi-triangle flat-color scene with only slanted edges (no vertex
 * shares an x or a y, so no edge is axis-aligned and no triangle degenerates
 * to a sliver — which is what makes local color uniformity a sound proxy for
 * "not near any edge" below).
 */
function renderTriangleScene(gl: HeadlessWebGL2): Uint8Array {
  gl.clearColor(0.1, 0.2, 0.3, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const program = flatColorRig(gl, 0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
  uploadAttrib(gl, 0, 2, [-0.9, -0.85, 0.7, -0.6, -0.3, 0.8]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.uniform4f(gl.getUniformLocation(program, "u_color"), 0.8, 0.2, 0.1, 1);
  uploadAttrib(gl, 0, 2, [0.1, -0.9, 0.95, 0.15, 0.35, 0.9]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.uniform4f(gl.getUniformLocation(program, "u_color"), 0.2, 0.7, 0.3, 1);
  uploadAttrib(gl, 0, 2, [-0.85, 0.05, -0.05, -0.25, -0.45, 0.95]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return readAll(gl, SCENE_SIZE, SCENE_SIZE);
}

/** Whether every pixel within Chebyshev `radius` of (x, y) carries identical bytes in `img`. */
function uniformAround(
  img: Uint8Array,
  x: number,
  y: number,
  radius: number,
): boolean {
  const center = (y * SCENE_SIZE + x) * 4;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= SCENE_SIZE || ny < 0 || ny >= SCENE_SIZE)
        return false;
      const at = (ny * SCENE_SIZE + nx) * 4;
      for (let c = 0; c < 4; c += 1) {
        if (img[at + c] !== img[center + c]) return false;
      }
    }
  }
  return true;
}

describe("the interior-exactness invariant", () => {
  it("keeps every pixel two device pixels inside an edge byte-equal to the single-sample picture — the documented safe margin", () => {
    const aa = renderTriangleScene(makeGl(SCENE_SIZE, SCENE_SIZE));
    const single = renderTriangleScene(
      makeGl(SCENE_SIZE, SCENE_SIZE, { antialias: false }),
    );
    let interiorCount = 0;
    const interiorColors = new Set<number>();
    for (let y = 0; y < SCENE_SIZE; y += 1) {
      for (let x = 0; x < SCENE_SIZE; x += 1) {
        // Uniformity over the 5×5 neighborhood of the single-sample picture
        // means no edge crosses within two pixels: all four of the AA
        // picture's subsamples land in the same flat surface, and their box
        // filter must return that surface's exact bytes.
        if (!uniformAround(single, x, y, 2)) continue;
        interiorCount += 1;
        const at = (y * SCENE_SIZE + x) * 4;
        interiorColors.add(
          (single[at] ?? 0) |
            ((single[at + 1] ?? 0) << 8) |
            ((single[at + 2] ?? 0) << 16),
        );
        expect(
          [aa[at], aa[at + 1], aa[at + 2], aa[at + 3]],
          `pixel (${x}, ${y})`,
        ).toEqual([single[at], single[at + 1], single[at + 2], single[at + 3]]);
      }
    }
    // The scene must actually exercise the claim: plenty of interior pixels,
    // across the background and at least two triangle fills.
    expect(interiorCount).toBeGreaterThan(100);
    expect(interiorColors.size).toBeGreaterThanOrEqual(3);
  });

  it("differs from the single-sample picture only within two pixels of an edge, and does differ somewhere", () => {
    const aa = renderTriangleScene(makeGl(SCENE_SIZE, SCENE_SIZE));
    const single = renderTriangleScene(
      makeGl(SCENE_SIZE, SCENE_SIZE, { antialias: false }),
    );
    let differing = 0;
    for (let y = 0; y < SCENE_SIZE; y += 1) {
      for (let x = 0; x < SCENE_SIZE; x += 1) {
        const at = (y * SCENE_SIZE + x) * 4;
        const differs =
          aa[at] !== single[at] ||
          aa[at + 1] !== single[at + 1] ||
          aa[at + 2] !== single[at + 2] ||
          aa[at + 3] !== single[at + 3];
        if (!differs) continue;
        differing += 1;
        // Anywhere the pictures disagree, an edge runs nearby.
        expect(
          uniformAround(single, x, y, 2),
          `pixel (${x}, ${y}) differs away from any edge`,
        ).toBe(false);
      }
    }
    // Slanted edges must blend: identical pictures would mean the antialias
    // attribute quietly did nothing.
    expect(differing).toBeGreaterThan(0);
  });

  it("draws an unlit CSS hex interior byte-exact with antialias on — the structured-3d validator claim verbatim", () => {
    const gl = makeGl(8, 8);
    flatColorRig(gl, 0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(pixel(gl, 4, 4)).toEqual([0xf2, 0xf5, 0xf7, 255]);
  });
});

/* ------------------------------------------------------------------------ */
/* Edge blending                                                            */
/* ------------------------------------------------------------------------ */

describe("edge antialiasing", () => {
  it("resolves a diagonal edge pixel to the coverage-weighted mix of the two sides", () => {
    const gl = makeGl(8, 8);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // A pixel with x + y == 7 sits on the hypotenuse with exactly one of its
    // four subsamples covered (index sums {14, 15, 15, 16} against the
    // sx + sy < 15 interior rule), so it resolves red at quarter strength
    // over the blue clear — strictly between the two sides.
    const edge = pixel(gl, 4, 3);
    expect(edge).toEqual([
      Math.round(255 / 4),
      0,
      Math.round((3 * 255) / 4),
      255,
    ]);
    // The neighbors either side of the edge stay byte-exact.
    expect(pixel(gl, 3, 3)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 5, 3)).toEqual([0, 0, 255, 255]);
  });

  it("resolves the forced alpha byte to 255 on an edge pixel under alpha: false", () => {
    const gl = makeGl(8, 8, { alpha: false });
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // Covered and uncovered subsamples alike store alpha 255 in an opaque
    // buffer, so even a quarter-covered pixel resolves fully opaque.
    expect(pixel(gl, 4, 3)[3]).toBe(255);
  });

  it("blends both sides of a depth intersection per subsample: the nearer surface wins each sample, edges mix", () => {
    const gl = makeGl(8, 8);
    gl.enable(gl.DEPTH_TEST);
    const program = buildProgram(
      gl,
      `#version 300 es
layout(location = 0) in vec3 a_pos;
void main() { gl_Position = vec4(a_pos, 1.0); }
`,
      FS_UNIFORM_COLOR,
    );
    // A far red full quad, then a nearer blue triangle whose hypotenuse
    // crosses the canvas: depth resolves per subsample, so the boundary
    // pixel mixes the two surfaces instead of snapping to either.
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 1, 0, 0, 1);
    uploadAttrib(
      gl,
      0,
      3,
      [-1, -1, 0.5, 1, -1, 0.5, -1, 1, 0.5, -1, 1, 0.5, 1, -1, 0.5, 1, 1, 0.5],
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 0, 0, 1, 1);
    uploadAttrib(gl, 0, 3, [-1, -1, -0.5, 1, -1, -0.5, -1, 1, -0.5]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(pixel(gl, 2, 2)).toEqual([0, 0, 255, 255]);
    expect(pixel(gl, 6, 6)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 4, 3)).toEqual([
      Math.round((3 * 255) / 4),
      0,
      Math.round(255 / 4),
      255,
    ]);
  });

  it("carries sample coordinates in gl_FragCoord, twice the device value at scale 2", () => {
    const gl = makeGl(2, 2);
    buildProgram(
      gl,
      VS_POS2,
      `#version 300 es
precision mediump float;
out vec4 o_color;
void main() { o_color = vec4(gl_FragCoord.x / 4.0, gl_FragCoord.y / 4.0, 0.0, 1.0); }
`,
    );
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // The 2×2 canvas rasters over a 4×4 sample space; device pixel 0 holds
    // subsample centers x = 0.5 and 1.5, pixel 1 holds 2.5 and 3.5, and the
    // resolve averages each pair's bytes.
    const lo = (byte(0.5 / 4) + byte(1.5 / 4)) / 2;
    const hi = (byte(2.5 / 4) + byte(3.5 / 4)) / 2;
    expect(pixel(gl, 0, 0)).toEqual([lo, lo, 0, 255]);
    expect(pixel(gl, 1, 1)).toEqual([hi, hi, 0, 255]);
  });
});

/* ------------------------------------------------------------------------ */
/* Clears, lines, and reporting                                             */
/* ------------------------------------------------------------------------ */

describe("supersampled clears and lines", () => {
  it("keeps a scissored clear byte-exact with a crisp device-aligned boundary — the letterbox idiom", () => {
    const gl = makeGl(4, 4);
    gl.clearColor(0.1, 0.2, 0.3, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 4, 2);
    gl.clearColor(0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Every subsample of a cleared pixel takes the same bytes and the
    // scissor cuts between device rows, so both regions resolve exactly and
    // nothing blends at the boundary.
    expect(pixel(gl, 2, 1)).toEqual([0xf2, 0xf5, 0xf7, 255]);
    expect(pixel(gl, 2, 2)).toEqual([byte(0.1), byte(0.2), byte(0.3), 255]);
  });

  it("keeps a line one full-intensity device pixel wide, byte-identical to the single-sample line", () => {
    const drawLine = (gl: HeadlessWebGL2): Uint8Array => {
      flatColorRig(gl, 1, 0, 0, 1);
      // Row 2, columns 1..6, plus a diagonal for slope coverage.
      uploadAttrib(gl, 0, 2, [
        ((1 + 0.5) / 8) * 2 - 1,
        ((2 + 0.5) / 8) * 2 - 1,
        ((6 + 0.5) / 8) * 2 - 1,
        ((2 + 0.5) / 8) * 2 - 1,
        -1 + 0.5 / 4,
        -1 + 0.5 / 4,
        1 - 0.5 / 4,
        1 - 0.5 / 4,
      ]);
      gl.drawArrays(gl.LINES, 0, 4);
      return readAll(gl, 8, 8);
    };
    const aa = drawLine(makeGl(8, 8));
    const single = drawLine(makeGl(8, 8, { antialias: false }));
    // Lines raster whole device pixels (every subsample written), so the
    // supersampled picture is the single-sample picture — no half-covered
    // smear, no dimming.
    expect(Array.from(aa)).toEqual(Array.from(single));
    const gl = makeGl(8, 8);
    flatColorRig(gl, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [
      ((1 + 0.5) / 8) * 2 - 1,
      ((2 + 0.5) / 8) * 2 - 1,
      ((6 + 0.5) / 8) * 2 - 1,
      ((2 + 0.5) / 8) * 2 - 1,
    ]);
    gl.drawArrays(gl.LINES, 0, 2);
    expect(pixel(gl, 3, 2)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 3, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(gl, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it("reports SAMPLES 4 and SAMPLE_BUFFERS 1 with antialias on, and 0/0 with it off", () => {
    const aa = makeGl(2, 2);
    expect(aa.getParameter(aa.SAMPLES)).toBe(4);
    expect(aa.getParameter(aa.SAMPLE_BUFFERS)).toBe(1);
    const single = makeGl(2, 2, { antialias: false });
    expect(single.getParameter(single.SAMPLES)).toBe(0);
    expect(single.getParameter(single.SAMPLE_BUFFERS)).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/* Determinism                                                              */
/* ------------------------------------------------------------------------ */

describe("antialiased determinism", () => {
  it("produces byte-identical pictures for two identical supersampled renders, edge blends included", () => {
    const render = (): Uint8Array => {
      const gl = makeGl(16, 16);
      const bytes = renderTriangleScene(makeGl(SCENE_SIZE, SCENE_SIZE));
      // A second, blended pass over a fresh context exercises the resolve
      // together with blending and depth on the same run.
      gl.clearColor(0.3, 0.3, 0.3, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      flatColorRig(gl, 0.9, 0.4, 0.2, 0.5);
      uploadAttrib(gl, 0, 2, [-0.95, -0.8, 0.85, -0.45, -0.15, 0.9]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const second = readAll(gl, 16, 16);
      const out = new Uint8Array(bytes.length + second.length);
      out.set(bytes, 0);
      out.set(second, bytes.length);
      return out;
    };
    expect(Array.from(render())).toEqual(Array.from(render()));
  });
});
