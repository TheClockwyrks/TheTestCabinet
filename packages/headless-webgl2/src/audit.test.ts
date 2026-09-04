import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * The adversarial audit suite: independently derived checks of the package's
 * hardest numerical claims, written against the public GL surface with every
 * expected value computed in this file from first principles rather than
 * copied from an implementation constant. Where a neighboring suite already
 * pins a claim (`context.draws.test.ts` owns the golden scenes,
 * `context.ssaa.test.ts` the supersampling invariants), this file pushes the
 * same claim into harsher territory: a 16:1 depth ratio instead of a gentle
 * slant, a six-triangle pinwheel instead of one shared edge, geometry
 * straddling the camera plane, texel-boundary sampling, and cross-context
 * (not merely double-run) determinism.
 *
 * Single-sample (`antialias: false`) is pinned wherever the claim is a
 * pixel-center truth — perspective ratios and coverage sets are nonlinear
 * under the 2×2 box filter, and byte exactness is only promised for flat
 * interiors.
 */

/* ------------------------------------------------------------------------ */
/* Fixtures                                                                 */
/* ------------------------------------------------------------------------ */

/** The package's one float→byte rule, restated so expectations are checkable in-file. */
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

/** Uploads a float attribute array to a fresh buffer and points `location` at it. */
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

/** One pixel's RGBA bytes, x/y in readPixels' bottom-up addressing. */
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

const FS_FLAT = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o_color;
void main() { o_color = u_color; }
`;

const VS_POS2 = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/** A vertex shader taking raw clip coordinates — the seam for near-plane geometry. */
const VS_CLIP4 = `#version 300 es
layout(location = 0) in vec4 a_clip;
void main() { gl_Position = a_clip; }
`;

/* ------------------------------------------------------------------------ */
/* Perspective-correct interpolation at a 16:1 depth ratio                  */
/* ------------------------------------------------------------------------ */

describe("audit: perspective-correct interpolation", () => {
  it("matches the projective edge formula across a quad whose depth ratio is 16:1", () => {
    // A planar surface receding from w = 1 at the left screen edge to w = 16
    // at the right, carrying a varying t: 0 on the left, 1 on the right. The
    // eye-space corners (-1, ±1, -1) and (16, ±16, -16) are coplanar and t is
    // affine over that plane, so perspective-correct interpolation must
    // reproduce the two-point projective formula along every horizontal line:
    //   t(s) = (s / w1) / ((1 - s) / w0 + s / w1) = s / (16 - 15 s)
    // where s is the screen-space fraction across the quad. Screen-linear
    // (non-perspective) interpolation would instead give t(s) = s — off by up
    // to ~7× mid-screen at this ratio, so the test cannot pass by accident.
    const gl = makeGl(16, 4, { antialias: false });
    buildProgram(
      gl,
      `#version 300 es
layout(location = 0) in vec2 a_ndc;
layout(location = 1) in float a_w;
layout(location = 2) in float a_t;
out float v_t;
void main() {
  v_t = a_t;
  gl_Position = vec4(a_ndc * a_w, 0.0, a_w);
}
`,
      `#version 300 es
precision mediump float;
in float v_t;
out vec4 o_color;
void main() { o_color = vec4(v_t, 0.0, 0.0, 1.0); }
`,
    );
    // Two triangles, TRIANGLES order: (BL, BR, TL), (TL, BR, TR).
    uploadAttrib(gl, 0, 2, [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    uploadAttrib(gl, 1, 1, [1, 16, 1, 1, 16, 16]);
    uploadAttrib(gl, 2, 1, [0, 1, 0, 0, 1, 1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    for (let px = 0; px < 16; px += 1) {
      const s = (px + 0.5) / 16;
      const expected = byte(s / (16 - 15 * s));
      // Both rows of the quad interior agree — the varying is constant
      // vertically, and the diagonal seam must not disturb it (the surface is
      // planar, so both triangles interpolate the same projective function).
      expect(pixel(gl, px, 1)[0], `bottom-triangle pixel (${px}, 1)`).toBe(
        expected,
      );
      expect(pixel(gl, px, 2)[0], `top-triangle pixel (${px}, 2)`).toBe(
        expected,
      );
    }
    // Spot-check the midpoint against the hand-derived closed form: at
    // s = 8.5/16, t = 8.5 / (256 - 127.5) = 0.06614..., nowhere near the
    // screen-linear 0.53 — the depth ratio is actually being honored.
    expect(pixel(gl, 8, 1)[0]).toBe(byte(8.5 / 128.5));
  });
});

/* ------------------------------------------------------------------------ */
/* Top-left fill rule on a six-triangle pinwheel                            */
/* ------------------------------------------------------------------------ */

describe("audit: shared-edge ownership", () => {
  it("paints every pixel of a six-triangle pinwheel exactly once under additive blending", () => {
    // Six triangles fan around an off-center hub, every spoke edge shared by
    // two triangles and the hub shared by all six. Additive blending with a
    // 60/255 wash makes ownership countable: a double-painted pixel reads
    // 120, a missed pixel 0, single ownership exactly 60. The outer ring
    // (radius 3 in NDC) keeps the whole canvas inside the fan, so *every*
    // pixel must read exactly 60 — the fill rule proven over six different
    // edge orientations at once, not just one diagonal.
    const gl = makeGl(9, 9, { antialias: false });
    const program = buildProgram(gl, VS_POS2, FS_FLAT);
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 60 / 255, 0, 0, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const hub = [0.05, -0.1];
    const positions: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      // A 10° phase keeps spokes off the axes so no edge is axis-aligned.
      const a0 = ((i * 60 + 10) * Math.PI) / 180;
      const a1 = (((i + 1) * 60 + 10) * Math.PI) / 180;
      positions.push(
        hub[0] ?? 0,
        hub[1] ?? 0,
        (hub[0] ?? 0) + 3 * Math.cos(a0),
        (hub[1] ?? 0) + 3 * Math.sin(a0),
        (hub[0] ?? 0) + 3 * Math.cos(a1),
        (hub[1] ?? 0) + 3 * Math.sin(a1),
      );
    }
    uploadAttrib(gl, 0, 2, positions);
    gl.drawArrays(gl.TRIANGLES, 0, 18);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    for (let y = 0; y < 9; y += 1) {
      for (let x = 0; x < 9; x += 1) {
        expect(pixel(gl, x, y), `pixel (${x}, ${y})`).toEqual([60, 0, 0, 255]);
      }
    }
  });
});

/* ------------------------------------------------------------------------ */
/* readPixels row order down to the byte offset                             */
/* ------------------------------------------------------------------------ */

describe("audit: readPixels row order", () => {
  it("lands a drawn bottom-row pixel at the bottom-up byte offset of a full readback", () => {
    // A single point drawn into device column 2 of the bottom screen row.
    // Bottom-up addressing puts the bottom row first in the readback, so the
    // pixel's bytes must sit at offset (0 * width + 2) * 4 = 8 — and nowhere
    // else in the whole buffer.
    const gl = makeGl(5, 4, { antialias: false });
    const program = buildProgram(gl, VS_POS2, FS_FLAT);
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 1, 0, 0, 1);
    // Device pixel (2, bottom): NDC x = (2.5 / 5) * 2 - 1 = 0, y for the
    // bottom row's center = (0.5 / 4) * 2 - 1 = -0.75.
    uploadAttrib(gl, 0, 2, [0, -0.75]);
    gl.drawArrays(gl.POINTS, 0, 1);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    const all = readAll(gl, 5, 4);
    for (let i = 0; i < all.length; i += 4) {
      const expected = i === 8 ? [255, 0, 0, 255] : [0, 0, 0, 0];
      expect(
        [all[i], all[i + 1], all[i + 2], all[i + 3]],
        `byte offset ${i}`,
      ).toEqual(expected);
    }
    // The same pixel through a 1×1 read at y = 0 (the bottom), and its absence
    // at y = 3 (the top): row 0 really is the bottom of the canvas.
    expect(pixel(gl, 2, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(gl, 2, 3)).toEqual([0, 0, 0, 0]);
  });
});

/* ------------------------------------------------------------------------ */
/* Near-plane clipping and depth across it                                  */
/* ------------------------------------------------------------------------ */

describe("audit: near-plane clipping", () => {
  /**
   * A triangle with one vertex behind the camera (clip w = -0.5). Unclipped,
   * that vertex would divide to NDC (-2, 0) and rasterize wraparound garbage
   * to the LEFT of the visible geometry; clipped correctly, the surviving
   * shape covers a right-and-upward wedge from x = -0.5, y = 0.
   */
  const STRADDLER = [-0.5, 0, 0.2, 1, 1, 0, 0.2, -0.5, -0.5, 0.9, 0.2, 1];

  it("rasterizes only the in-front wedge of a camera-straddling triangle, with no wraparound", () => {
    const gl = makeGl(8, 8, { antialias: false });
    const program = buildProgram(gl, VS_CLIP4, FS_FLAT);
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 1, 0, 0, 1);
    uploadAttrib(gl, 0, 4, STRADDLER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    for (let py = 0; py < 8; py += 1) {
      for (let px = 0; px < 8; px += 1) {
        // Pixel-center NDC: x = (px + 0.5) / 8 * 2 - 1, same for y. The
        // clipped wedge's screen edges are x = -0.5 (left), y = 0 (bottom),
        // and a top edge running from (-0.5, 0.9) toward NDC (5e5, 3e5) —
        // far above every on-screen pixel for x ≥ -0.375. So: filled iff
        // px ≥ 2 and py ≥ 4.
        const filled = px >= 2 && py >= 4;
        expect(pixel(gl, px, py), `pixel (${px}, ${py})`).toEqual(
          filled ? [255, 0, 0, 255] : [0, 0, 0, 0],
        );
      }
    }
  });

  it("orders depth consistently across the clip: draw order does not change the picture", () => {
    // The straddling triangle's window depth is (0.2 / w + 1) / 2, running
    // from 0.6 near its front edge toward 1 at the clip boundary; a full
    // screen quad sits at constant depth 0.75. Each wins somewhere, and the
    // winner must come from the depth buffer, not the draw order — the
    // depth-through-clip claim in its sharpest observable form.
    const render = (triangleFirst: boolean): Uint8Array => {
      const gl = makeGl(8, 8, { antialias: false });
      const program = buildProgram(gl, VS_CLIP4, FS_FLAT);
      const color = gl.getUniformLocation(program, "u_color");
      gl.enable(gl.DEPTH_TEST);
      const drawTriangle = (): void => {
        gl.uniform4f(color, 1, 0, 0, 1);
        uploadAttrib(gl, 0, 4, STRADDLER);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const drawQuad = (): void => {
        gl.uniform4f(color, 0, 0, 1, 1);
        // Full-screen quad at NDC z = 0.5 → window depth 0.75.
        uploadAttrib(
          gl,
          0,
          4,
          [
            -1, -1, 0.5, 1, 1, -1, 0.5, 1, -1, 1, 0.5, 1, -1, 1, 0.5, 1, 1, -1,
            0.5, 1, 1, 1, 0.5, 1,
          ],
        );
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      if (triangleFirst) {
        drawTriangle();
        drawQuad();
      } else {
        drawQuad();
        drawTriangle();
      }
      expect(gl.getError()).toBe(gl.NO_ERROR);
      return readAll(gl, 8, 8);
    };
    const first = render(true);
    const second = render(false);
    expect(Array.from(second)).toEqual(Array.from(first));
    // Sanity that the comparison is not vacuous: both surfaces win somewhere
    // inside the triangle's covered band (red near its front edge where depth
    // ≈ 0.6, blue toward the clip boundary where depth has climbed past 0.75).
    const bytesAt = (px: number, py: number): number[] =>
      Array.from(first.subarray((py * 8 + px) * 4, (py * 8 + px) * 4 + 4));
    expect(bytesAt(2, 4)).toEqual([255, 0, 0, 255]);
    expect(bytesAt(7, 4)).toEqual([0, 0, 255, 255]);
  });

  it("writes strictly increasing, in-range depth toward the clip boundary — no divide blowup", () => {
    // With constant clip z = 0.2, window depth is (0.2 · invW + 1) / 2 and
    // invW grows toward the crossing at w = ε, so along the covered row the
    // stored depth must climb strictly and stay inside (0.5, 1] — a wrong
    // clip (interpolating after the divide, or dividing by a stale w) would
    // surface here as a plateau, a reversal, or an out-of-range value.
    const gl = makeGl(8, 8, { antialias: false });
    const program = buildProgram(gl, VS_CLIP4, FS_FLAT);
    gl.uniform4f(gl.getUniformLocation(program, "u_color"), 1, 0, 0, 1);
    gl.enable(gl.DEPTH_TEST);
    uploadAttrib(gl, 0, 4, STRADDLER);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    const depth = gl.framebufferForTesting.depthPlane;
    let previous = 0.5;
    for (let px = 2; px < 8; px += 1) {
      const d = depth[4 * 8 + px] ?? 0;
      expect(d, `depth at (${px}, 4)`).toBeGreaterThan(previous);
      expect(d, `depth at (${px}, 4)`).toBeLessThanOrEqual(1);
      previous = d;
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Uniform-array loop through the real draw path                            */
/* ------------------------------------------------------------------------ */

describe("audit: uniform arrays in a loop", () => {
  it("sums a uniform-bounded slice of a uniform array, and a mid-array element update lands", () => {
    const gl = makeGl(2, 2, { antialias: false });
    const program = buildProgram(
      gl,
      VS_POS2,
      `#version 300 es
precision mediump float;
uniform float u_vals[8];
uniform int u_count;
out vec4 o_color;
void main() {
  float sum = 0.0;
  for (int i = 0; i < u_count; i++) {
    sum += u_vals[i];
  }
  o_color = vec4(sum / 8.0, 0.0, 0.0, 1.0);
}
`,
    );
    uploadAttrib(gl, 0, 2, [-1, -1, 3, -1, -1, 3]);
    // f32-exact values so no representation slack hides an indexing slip.
    const values = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0];
    gl.uniform1fv(gl.getUniformLocation(program, "u_vals"), values);
    gl.uniform1i(gl.getUniformLocation(program, "u_count"), 5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // First five: 0.125 + 0.25 + 0.375 + 0.5 + 0.625 = 1.875 → /8 → byte 60.
    expect(pixel(gl, 0, 0)[0]).toBe(byte(1.875 / 8));
    // Zero u_vals[3] through its own element location: the loop must see the
    // update at exactly index 3 — sum 1.375 → byte 44.
    gl.uniform1f(gl.getUniformLocation(program, "u_vals[3]"), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(pixel(gl, 0, 0)[0]).toBe(byte(1.375 / 8));
  });
});

/* ------------------------------------------------------------------------ */
/* LINEAR sampling at texel boundaries                                      */
/* ------------------------------------------------------------------------ */

describe("audit: LINEAR filtering at texel boundaries", () => {
  /** Renders one constant-UV lookup of a 4×1 LINEAR texture with red bytes [10, 40, 200, 250]. */
  function sampleAt(u: number, wrap: "clamp" | "repeat"): number {
    const gl = makeGl(1, 1, { antialias: false });
    const program = buildProgram(
      gl,
      VS_POS2,
      `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_uv;
out vec4 o_color;
void main() { o_color = texture(u_tex, u_uv); }
`,
    );
    uploadAttrib(gl, 0, 2, [-1, -1, 3, -1, -1, 3]);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    const texels = new Uint8Array(4 * 4);
    [10, 40, 200, 250].forEach((r, i) => {
      texels[i * 4] = r;
      texels[i * 4 + 3] = 255;
    });
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      4,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      texels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const mode = wrap === "clamp" ? gl.CLAMP_TO_EDGE : gl.REPEAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, mode);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, mode);
    gl.uniform2f(gl.getUniformLocation(program, "u_uv"), u, 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    return pixel(gl, 0, 0)[0];
  }

  it("mixes the two texels flanking an interior boundary exactly 50/50", () => {
    // u = 0.5 on a 4-texel row is the boundary between texels 1 and 2: the
    // sample point sits at texel space 1.5, half a texel from each center, so
    // the blend is (40 + 200) / 2 = 120 — and 120/255 rounds back to 120.
    expect(sampleAt(0.5, "clamp")).toBe(byte((40 / 255 + 200 / 255) / 2));
    // u = 0.25, boundary between texels 0 and 1: (10 + 40) / 2 = 25.
    expect(sampleAt(0.25, "clamp")).toBe(byte((10 / 255 + 40 / 255) / 2));
  });

  it("blends across the wrap seam under REPEAT and clamps to the edge texel under CLAMP_TO_EDGE at u = 0", () => {
    // u = 0 puts the sample at texel space -0.5: REPEAT mixes the last and
    // first texels (250 + 10) / 2 = 130; CLAMP_TO_EDGE reads texel 0 twice,
    // exactly 10 — the two wrap rules disagree at the seam by design.
    expect(sampleAt(0, "repeat")).toBe(byte((250 / 255 + 10 / 255) / 2));
    expect(sampleAt(0, "clamp")).toBe(10);
  });

  it("returns a texel byte-exact at its own center", () => {
    // u = 0.375 is texel 1's center: fractions are 0, no neighbor leaks in.
    expect(sampleAt(0.375, "clamp")).toBe(40);
  });
});

/* ------------------------------------------------------------------------ */
/* Blend equation arithmetic                                                */
/* ------------------------------------------------------------------------ */

describe("audit: blend equation arithmetic", () => {
  /** Clears to `dst`, draws a full quad of `src` under the given blend state, returns the pixel. */
  function blendOnce(
    setup: (gl: HeadlessWebGL2) => void,
    dst: [number, number, number, number],
    src: [number, number, number, number],
  ): [number, number, number, number] {
    const gl = makeGl(2, 2, { antialias: false });
    const program = buildProgram(gl, VS_POS2, FS_FLAT);
    gl.clearColor(dst[0], dst[1], dst[2], dst[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    setup(gl);
    gl.uniform4f(
      gl.getUniformLocation(program, "u_color"),
      src[0],
      src[1],
      src[2],
      src[3],
    );
    uploadAttrib(gl, 0, 2, [-1, -1, 3, -1, -1, 3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    return pixel(gl, 0, 0);
  }

  it("computes FUNC_SUBTRACT as src minus dst, clamped at zero per channel", () => {
    const out = blendOnce(
      (gl) => {
        gl.blendEquation(gl.FUNC_SUBTRACT);
        gl.blendFunc(gl.ONE, gl.ONE);
      },
      [100 / 255, 100 / 255, 0, 1],
      [200 / 255, 30 / 255, 0, 1],
    );
    // Red: 200 - 100 = 100. Green: 30 - 100 clamps to 0. Alpha: 1 - 1 = 0.
    expect(out).toEqual([100, 0, 0, 0]);
  });

  it("modulates through DST_COLOR/ZERO with the exact fixed-point product", () => {
    const out = blendOnce(
      (gl) => {
        gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      },
      [100 / 255, 51 / 255, 1, 1],
      [200 / 255, 1, 0.5, 1],
    );
    // Red: (200/255)·(100/255) → byte 78 — a value with real rounding, so an
    // implementation that multiplied bytes rather than floats would miss it.
    expect(out[0]).toBe(byte((200 / 255) * (100 / 255)));
    // Green: full-strength src against dst 51 passes the dst byte through.
    expect(out[1]).toBe(51);
    // Alpha follows the same factors: 1 · 1 = 1.
    expect(out[3]).toBe(255);
  });
});

/* ------------------------------------------------------------------------ */
/* Canvas resize semantics                                                  */
/* ------------------------------------------------------------------------ */

describe("audit: canvas resize", () => {
  it("clears color and depth on a same-size width assignment, per the HTML canvas contract", () => {
    const canvas = createCanvas(6, 4);
    const gl = canvas.getContext("webgl2", { antialias: false });
    const program = buildProgram(gl, VS_POS2, FS_FLAT);
    const color = gl.getUniformLocation(program, "u_color");
    gl.enable(gl.DEPTH_TEST);
    gl.uniform4f(color, 1, 0, 0, 1);
    uploadAttrib(gl, 0, 2, [-1, -1, 3, -1, -1, 3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(pixel(gl, 0, 0)).toEqual([255, 0, 0, 255]);

    // Assigning the same width still reallocates and clears — both planes.
    canvas.width = 6;
    expect(Array.from(readAll(gl, 6, 4))).toEqual(new Array(6 * 4 * 4).fill(0));

    // The depth plane is back at 1: a redraw at the same depth (0.5) passes
    // the default LESS test, which it could not have against the old plane.
    gl.uniform4f(color, 0, 1, 0, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(pixel(gl, 0, 0)).toEqual([0, 255, 0, 255]);
  });

  it("tracks a real size change through drawingBufferWidth/Height", () => {
    const canvas = createCanvas(6, 4);
    const gl = canvas.getContext("webgl2");
    canvas.width = 3;
    canvas.height = 2;
    expect(gl.drawingBufferWidth).toBe(3);
    expect(gl.drawingBufferHeight).toBe(2);
    // readPixels beyond the new bounds leaves the destination untouched.
    const probe = new Uint8Array([9, 9, 9, 9]);
    gl.readPixels(3, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
    expect(Array.from(probe)).toEqual([9, 9, 9, 9]);
  });
});

/* ------------------------------------------------------------------------ */
/* getError sequencing                                                      */
/* ------------------------------------------------------------------------ */

describe("audit: getError sequencing", () => {
  it("latches distinct codes oldest-first from real misuse, dedupes repeats, and paints nothing", () => {
    const gl = makeGl(4, 4, { antialias: false });
    // 1. Draw with no program: INVALID_OPERATION, framebuffer untouched.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // 2. Unknown depth function: INVALID_ENUM.
    gl.depthFunc(0x9999);
    // 3. Negative viewport extent: INVALID_VALUE.
    gl.viewport(0, 0, -1, 4);
    // 4. Repeat of the unread INVALID_ENUM: dropped, per the latched-flag rule.
    gl.depthFunc(0x9999);
    expect(Array.from(readAll(gl, 4, 4))).toEqual(new Array(4 * 4 * 4).fill(0));
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    // Once read, a recurrence latches afresh.
    gl.depthFunc(0x9999);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });
});

/* ------------------------------------------------------------------------ */
/* Determinism across two independent contexts                              */
/* ------------------------------------------------------------------------ */

describe("audit: cross-context determinism", () => {
  it("produces byte-identical supersampled frames from two separately created canvases", () => {
    // Not a double-run on one context (the neighboring suites cover that):
    // two canvases created independently, exercised through every subsystem
    // the audit touches — texture LINEAR, blending, depth, a camera-straddling
    // triangle, a line — under the default 2×2 supersampling.
    const render = (): Uint8Array => {
      const gl = makeGl(16, 12);
      const program = buildProgram(
        gl,
        `#version 300 es
layout(location = 0) in vec4 a_clip;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() { gl_Position = a_clip; v_uv = a_uv; }
`,
        `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_tint;
out vec4 o_color;
void main() { o_color = texture(u_tex, v_uv) + u_tint; }
`,
      );
      const tint = gl.getUniformLocation(program, "u_tint");
      gl.clearColor(0.2, 0.3, 0.4, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);

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
          255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
        ]),
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      // A tilted textured quad receding in depth.
      gl.uniform4f(tint, 0, 0, 0, 0);
      uploadAttrib(
        gl,
        0,
        4,
        [
          -0.9, -0.9, 0, 1, 2.7, -2.7, 0.9, 3, -0.9, 0.9, 0, 1, -0.9, 0.9, 0, 1,
          2.7, -2.7, 0.9, 3, 2.7, 2.7, 0.9, 3,
        ],
      );
      uploadAttrib(gl, 1, 2, [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // A translucent triangle straddling the camera plane, blended over it.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform4f(tint, 0.8, 0.1, 0.1, 0.5);
      uploadAttrib(
        gl,
        0,
        4,
        [-0.5, 0, 0.1, 1, 1, 0, 0.1, -0.5, -0.5, 0.9, 0.1, 1],
      );
      uploadAttrib(gl, 1, 2, [0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // A diagonal line over everything.
      gl.disable(gl.DEPTH_TEST);
      gl.uniform4f(tint, 0.1, 0.9, 0.2, 1);
      uploadAttrib(gl, 0, 4, [-1, -1, 0, 1, 1, 0.7, 0, 1]);
      gl.drawArrays(gl.LINES, 0, 2);

      expect(gl.getError()).toBe(gl.NO_ERROR);
      return readAll(gl, 16, 12);
    };
    const first = render();
    const second = render();
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);
  });
});
