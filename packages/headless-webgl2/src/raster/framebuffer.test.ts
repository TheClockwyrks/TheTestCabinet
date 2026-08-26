import { describe, expect, it } from "vitest";
import { colorByte, DefaultFramebuffer } from "./framebuffer";
import { createCanvas } from "../index";
import type { HeadlessWebGL2 } from "../index";

/**
 * Two suites over the one module: a white-box half on the plane arithmetic
 * (clear rects, masks, byte conversion, pack strides — including the depth
 * plane, which the GL API deliberately cannot read back), and a through-the-
 * context half proving the documented readPixels contract: real bytes, rows
 * bottom-up, out-of-bounds pixels left untouched.
 */

describe("the planes", () => {
  it("starts cleared: color transparent black, depth 1", () => {
    const fb = new DefaultFramebuffer(2, 2, false);
    expect([...fb.colorPlane]).toEqual(Array.from({ length: 16 }, () => 0));
    expect([...fb.depthPlane]).toEqual([1, 1, 1, 1]);
  });

  it("forces every alpha byte to 255 when opaque, the alpha:false buffer shape", () => {
    const fb = new DefaultFramebuffer(2, 1, true);
    expect([...fb.colorPlane]).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
    fb.clearColorRect(
      { x: 0, y: 0, width: 2, height: 1 },
      [0.5, 0.5, 0.5, 0],
      [true, true, true, true],
    );
    expect(fb.colorPlane[3]).toBe(255);
  });

  it("rounds float color half away from zero, not to even — the byte-exactness rule", () => {
    // Uint8ClampedArray would give round-half-to-even; the contract is
    // Math.round, so 0.5 * 255 = 127.5 becomes 128.
    expect(colorByte(0.5)).toBe(128);
    // CSS hex colors round-trip exactly: 0xf2 / 255 back to 0xf2.
    expect(colorByte(0xf2 / 255)).toBe(0xf2);
    expect(colorByte(-1)).toBe(0);
    expect(colorByte(2)).toBe(255);
    expect(colorByte(Number.NaN)).toBe(0);
  });

  it("clears only the requested rect, clipped to the plane", () => {
    const fb = new DefaultFramebuffer(3, 3, false);
    fb.clearColorRect(
      { x: 1, y: 1, width: 5, height: 1 },
      [1, 1, 1, 1],
      [true, true, true, true],
    );
    // Row 1 (the middle), columns 1..2 painted; everything else untouched.
    const painted = (x: number, y: number): boolean =>
      fb.colorPlane[(y * 3 + x) * 4] === 255;
    expect(painted(0, 1)).toBe(false);
    expect(painted(1, 1)).toBe(true);
    expect(painted(2, 1)).toBe(true);
    expect(painted(1, 0)).toBe(false);
    expect(painted(1, 2)).toBe(false);
  });

  it("honors the per-channel color mask", () => {
    const fb = new DefaultFramebuffer(1, 1, false);
    fb.clearColorRect(
      { x: 0, y: 0, width: 1, height: 1 },
      [1, 1, 1, 1],
      [true, false, true, false],
    );
    expect([...fb.colorPlane]).toEqual([255, 0, 255, 0]);
  });

  it("clears depth over the rect only", () => {
    const fb = new DefaultFramebuffer(2, 2, false);
    fb.clearDepthRect({ x: 0, y: 1, width: 2, height: 1 }, 0.25);
    expect([...fb.depthPlane]).toEqual([1, 1, 0.25, 0.25]);
  });

  it("survives a rect entirely off the plane as a no-op", () => {
    const fb = new DefaultFramebuffer(2, 2, false);
    fb.clearColorRect(
      { x: 5, y: 5, width: 2, height: 2 },
      [1, 1, 1, 1],
      [true, true, true, true],
    );
    fb.clearDepthRect({ x: -4, y: 0, width: 2, height: 2 }, 0);
    expect([...fb.colorPlane]).toEqual(Array.from({ length: 16 }, () => 0));
    expect([...fb.depthPlane]).toEqual([1, 1, 1, 1]);
  });

  it("computes required readback bytes with pack-alignment stride on all rows but the last", () => {
    // 1×2 RGBA at alignment 8: first row padded to 8, last row exact.
    expect(DefaultFramebuffer.requiredBytes(1, 2, 8)).toBe(12);
    expect(DefaultFramebuffer.requiredBytes(1, 2, 4)).toBe(8);
    expect(DefaultFramebuffer.requiredBytes(2, 2, 8)).toBe(16);
    expect(DefaultFramebuffer.requiredBytes(0, 2, 4)).toBe(0);
  });
});

describe("the supersampled planes", () => {
  it("allocates scale² samples per pixel while reporting device dimensions", () => {
    const fb = new DefaultFramebuffer(2, 3, false, 2);
    expect([fb.width, fb.height]).toEqual([2, 3]);
    expect([fb.sampleWidth, fb.sampleHeight]).toEqual([4, 6]);
    expect(fb.colorPlane.length).toBe(4 * 6 * 4);
    expect(fb.depthPlane.length).toBe(4 * 6);
  });

  it("scales a device-space clear rect onto the sample planes", () => {
    const fb = new DefaultFramebuffer(2, 2, false, 2);
    fb.clearColorRect(
      { x: 1, y: 0, width: 1, height: 1 },
      [1, 0, 0, 1],
      [true, true, true, true],
    );
    fb.clearDepthRect({ x: 1, y: 0, width: 1, height: 1 }, 0.25);
    // Device pixel (1, 0) is sample columns 2..3 of sample rows 0..1.
    const red = (sx: number, sy: number): boolean =>
      fb.colorPlane[(sy * 4 + sx) * 4] === 255;
    expect(red(1, 0)).toBe(false);
    expect(red(2, 0)).toBe(true);
    expect(red(3, 1)).toBe(true);
    expect(red(2, 2)).toBe(false);
    expect(fb.depthPlane[2]).toBe(0.25);
    expect(fb.depthPlane[1]).toBe(1);
  });

  it("resolves each pixel as the rounded box filter of its subsample quad", () => {
    const fb = new DefaultFramebuffer(1, 1, false, 2);
    // Distinct subsample bytes written straight into the plane: the resolve
    // must average them (sum / 4, Math.round), channel by channel.
    fb.colorPlane.set([
      10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255, 41, 0, 0, 255,
    ]);
    const out = new Uint8Array(4);
    fb.readPixels(0, 0, 1, 1, out, 4, 0);
    // (10 + 20 + 30 + 41) / 4 = 25.25 → 25; alpha 255 exact.
    expect([...out]).toEqual([25, 0, 0, 255]);
  });

  it("resolves four agreeing subsamples to their exact byte — the interior-exactness rule", () => {
    const fb = new DefaultFramebuffer(1, 1, false, 2);
    fb.clearColorRect(
      { x: 0, y: 0, width: 1, height: 1 },
      [0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1],
      [true, true, true, true],
    );
    const out = new Uint8Array(4);
    fb.readPixels(0, 0, 1, 1, out, 4, 0);
    expect([...out]).toEqual([0xf2, 0xf5, 0xf7, 255]);
  });

  it("leaves out-of-bounds destination bytes untouched through the resolve path too", () => {
    const fb = new DefaultFramebuffer(2, 2, false, 2);
    fb.clearColorRect(
      { x: 0, y: 0, width: 2, height: 2 },
      [1, 1, 1, 1],
      [true, true, true, true],
    );
    const out = new Uint8Array(16).fill(7);
    fb.readPixels(-1, -1, 2, 2, out, 4, 0);
    expect([...out.subarray(0, 12)]).toEqual(
      Array.from({ length: 12 }, () => 7),
    );
    expect([...out.subarray(12, 16)]).toEqual([255, 255, 255, 255]);
  });
});

describe("clear and readPixels through the context", () => {
  function makeGl(width = 4, height = 4): HeadlessWebGL2 {
    return createCanvas(width, height).getContext("webgl2");
  }

  /** Reads one pixel as an [r, g, b, a] array. */
  function sample(gl: HeadlessWebGL2, x: number, y: number): number[] {
    const bytes = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    return [...bytes];
  }

  it("returns the exact bytes of a full-buffer clear, byte-exact for CSS hex colors", () => {
    const gl = makeGl(2, 2);
    gl.clearColor(0xf2 / 255, 0xf5 / 255, 0xf7 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const bytes = new Uint8Array(16);
    gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    expect([...bytes]).toEqual([
      0xf2, 0xf5, 0xf7, 255, 0xf2, 0xf5, 0xf7, 255, 0xf2, 0xf5, 0xf7, 255, 0xf2,
      0xf5, 0xf7, 255,
    ]);
  });

  it("addresses rows bottom-up: row 0 of the readback is the bottom of the canvas", () => {
    const gl = makeGl(2, 4);
    // Clear everything red, then scissor the TOP half green. A scissored
    // clear covers window rows 2..3, which are the HIGH y values in GL's
    // bottom-left coordinate system.
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 2, 2, 2);
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    expect(sample(gl, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(sample(gl, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(sample(gl, 0, 2)).toEqual([0, 255, 0, 255]);
    expect(sample(gl, 0, 3)).toEqual([0, 255, 0, 255]);
    // A two-row readback lays the lower (red) row first in dest.
    const bytes = new Uint8Array(16);
    gl.readPixels(0, 1, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    expect([...bytes.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...bytes.subarray(8, 12)]).toEqual([0, 255, 0, 255]);
  });

  it("bounds a clear by the scissor box only while SCISSOR_TEST is enabled", () => {
    const gl = makeGl(2, 2);
    gl.scissor(0, 0, 1, 1);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Scissor disabled: the whole buffer cleared despite the small box.
    expect(sample(gl, 1, 1)).toEqual([255, 255, 255, 255]);
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    expect(sample(gl, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(sample(gl, 1, 1)).toEqual([255, 255, 255, 255]);
  });

  it("honors the color mask during a clear", () => {
    const gl = makeGl(1, 1);
    gl.clearColor(1, 1, 1, 1);
    gl.colorMask(true, false, false, true);
    gl.clear(gl.COLOR_BUFFER_BIT);
    expect(sample(gl, 0, 0)).toEqual([255, 0, 0, 255]);
  });

  it("clears depth through the depth mask gate", () => {
    const gl = makeGl(1, 1);
    const depth = gl.framebufferForTesting.depthPlane;
    gl.clearDepth(0.5);
    gl.depthMask(false);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // depthMask false gates the clear, per GL.
    expect(depth[0]).toBe(1);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    expect(depth[0]).toBe(0.5);
  });

  it("refuses undefined clear mask bits with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.clear(0x2);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("leaves out-of-bounds destination bytes untouched, per the readPixels spec", () => {
    const gl = makeGl(2, 2);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // A 2×2 read anchored one pixel below-left of the buffer: only the
    // top-right quadrant of the read lands inside.
    const bytes = new Uint8Array(16).fill(7);
    gl.readPixels(-1, -1, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    // dest row 0 (y = -1) is fully outside: untouched sentinel bytes.
    expect([...bytes.subarray(0, 8)]).toEqual([7, 7, 7, 7, 7, 7, 7, 7]);
    // dest row 1, column 0 (x = -1) outside; column 1 inside.
    expect([...bytes.subarray(8, 12)]).toEqual([7, 7, 7, 7]);
    expect([...bytes.subarray(12, 16)]).toEqual([255, 255, 255, 255]);
  });

  it("honors PACK_ALIGNMENT 8 by padding all rows but the last", () => {
    const gl = makeGl(2, 2);
    gl.clearColor(1, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 8);
    const bytes = new Uint8Array(12).fill(7);
    gl.readPixels(0, 0, 1, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    // Row 0 at offset 0, row 1 at the 8-byte stride; the pad bytes untouched.
    expect([...bytes]).toEqual([255, 0, 0, 255, 7, 7, 7, 7, 255, 0, 0, 255]);
  });

  it("writes from dstOffset onward", () => {
    const gl = makeGl(1, 1);
    gl.clearColor(0, 1, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const bytes = new Uint8Array(8).fill(7);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes, 4);
    expect([...bytes]).toEqual([7, 7, 7, 7, 0, 255, 0, 255]);
  });

  it("refuses any format/type pair other than RGBA and UNSIGNED_BYTE with INVALID_ENUM", () => {
    const gl = makeGl();
    const bytes = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGB, gl.UNSIGNED_BYTE, bytes);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, bytes);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("refuses a wrong destination view type with INVALID_OPERATION", () => {
    const gl = makeGl();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Float32Array(4));
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });

  it("refuses a too-small destination with INVALID_OPERATION and touches nothing", () => {
    const gl = makeGl(2, 2);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const bytes = new Uint8Array(15).fill(7);
    gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    expect([...bytes]).toEqual(Array.from({ length: 15 }, () => 7));
  });

  it("refuses negative extents and a null destination with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.readPixels(0, 0, -1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, null);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
  });

  it("produces byte-identical planes for two contexts fed the same operation stream", () => {
    const run = (): Uint8Array => {
      const gl = makeGl(4, 4);
      gl.clearColor(0.3, 0.6, 0.9, 0.5);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(1, 1, 2, 2);
      gl.clearColor(0.123, 0.456, 0.789, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const bytes = new Uint8Array(4 * 4 * 4);
      gl.readPixels(0, 0, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    expect([...run()]).toEqual([...run()]);
  });
});
