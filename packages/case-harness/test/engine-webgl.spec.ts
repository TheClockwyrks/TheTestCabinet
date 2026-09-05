// The WebGL2 stub a 3D case's renderer stands up over.
//
// Nothing here rasterizes and nothing pretends to: what these checks pin is that
// the stub answers the handful of questions `THREE.WebGLRenderer` REFUSES to
// build without, and that it answers everything else harmlessly.

import { expect, it } from "vitest";
import { createGlStub, defineSelfForThree } from "../src/engine/webgl";

/**
 * As much of the stub as these checks reach for.
 *
 * Written out rather than left as an index signature, because an index signature
 * over a proxy that answers EVERY name would type each read as possibly absent
 * and bury what is under test in optional chaining. The stub really does answer
 * all of these; naming them is saying so.
 */
interface Gl {
  canvas: unknown;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  TEXTURE_2D: number;
  TEXTURE_3D: number;
  VERSION: number;
  RENDERER: number;
  VIEWPORT: number;
  MAX_TEXTURE_SIZE: number;
  MAX_VERTEX_ATTRIBS: number;
  MAX_VARYING_VECTORS: number;
  getParameter(name: number): unknown;
  getContextAttributes(): unknown;
  getExtension(name: string): unknown;
  getSupportedExtensions(): unknown;
  getShaderPrecisionFormat(shader: number, precision: number): unknown;
  getProgramParameter(program: unknown, name: number): unknown;
  getShaderParameter(shader: unknown, name: number): unknown;
  getProgramInfoLog(program: unknown): unknown;
  getError(): unknown;
  isContextLost(): unknown;
  createProgram(): unknown;
  createTexture(): unknown;
  bindTexture(target: number, texture: unknown): unknown;
  someMemberNobodyHasHeardOf(): unknown;
}

function stub(width = 640, height = 360): Gl {
  return createGlStub({ width, height }, "spec stub") as Gl;
}

it("reports the canvas's backing store as its drawing buffer", () => {
  const canvas = { width: 640, height: 360 };
  const gl = createGlStub(canvas) as Gl;
  expect(gl.drawingBufferWidth).toBe(640);
  canvas.width = 800;
  // Read through, not copied: a renderer that resized the canvas sees it.
  expect(gl.drawingBufferWidth).toBe(800);
  expect(gl.canvas).toBe(canvas);
});

it("mints a distinct constant for every all-caps name, stably", () => {
  const gl = stub();
  const first = gl.TEXTURE_2D;
  expect(typeof first).toBe("number");
  expect(Number.isInteger(first)).toBe(true);
  expect(gl.TEXTURE_2D).toBe(first);
  expect(gl.TEXTURE_3D).not.toBe(first);
  // Above the enum range a real context uses, so a stubbed value is never
  // mistaken for a borrowed one.
  expect(first).toBeGreaterThanOrEqual(0x10000);
});

it("answers a VERSION three can parse a major number out of", () => {
  const gl = stub();
  const version = gl.getParameter(gl.VERSION) as string;
  expect(/^WebGL (\d)/.exec(version)?.[1]).toBe("2");
  expect(version).toContain("spec stub");
  expect(gl.getParameter(gl.RENDERER)).toBe("spec stub");
});

it("answers the limits three sizes its own arrays from", () => {
  const gl = stub();
  expect(gl.getParameter(gl.MAX_TEXTURE_SIZE)).toBe(4096);
  expect(gl.getParameter(gl.MAX_VERTEX_ATTRIBS)).toBe(16);
  // Zero would be wrong in a way that only showed up as an empty draw later.
  expect(gl.getParameter(gl.MAX_VARYING_VECTORS)).toBeGreaterThan(0);
});

it("answers the viewport as a fresh buffer each read", () => {
  const gl = stub(640, 360);
  const first = gl.getParameter(gl.VIEWPORT) as Int32Array;
  expect([...first]).toEqual([0, 0, 640, 360]);
  first[2] = 1;
  // Built per read: three writes the result into its own state and must not be
  // handed a buffer this stub could change under it.
  expect([...(gl.getParameter(gl.VIEWPORT) as Int32Array)]).toEqual([
    0, 0, 640, 360,
  ]);
});

it("declines every extension, so three takes its conservative path", () => {
  const gl = stub();
  expect(gl.getExtension("EXT_anything")).toBeNull();
  expect(gl.getSupportedExtensions()).toEqual([]);
});

it("compiles and links everything, with an empty log", () => {
  const gl = stub();
  expect(gl.getProgramParameter({}, 0)).toBe(true);
  expect(gl.getShaderParameter({}, 0)).toBe(true);
  expect(gl.getProgramInfoLog({})).toBe("");
  expect(gl.getError()).toBe(0);
  expect(gl.isContextLost()).toBe(false);
});

it("gives every created object its own identity, which three keys caches by", () => {
  const gl = stub();
  expect(gl.createTexture()).not.toBe(gl.createTexture());
  expect(gl.createProgram()).not.toBe(gl.createProgram());
});

it("settles the shader precision negotiation on highp", () => {
  const format = stub().getShaderPrecisionFormat(0, 0) as {
    precision: number;
  };
  expect(format.precision).toBe(23);
});

it("anything unnamed is a method that takes anything and answers nothing", () => {
  const gl = stub();
  expect(gl.bindTexture(1, 2)).toBeUndefined();
  expect(gl.someMemberNobodyHasHeardOf()).toBeUndefined();
  // Memoized, so three holding on to a method gets the same function twice.
  expect(gl.bindTexture).toBe(gl.bindTexture);
});

it("reports every member as present, because three feature-tests by reading", () => {
  const gl = stub();
  expect("drawArraysInstanced" in gl).toBe(true);
  expect("nothingLikeThis" in gl).toBe(true);
});

it("reports the attributes already resolved, with no multisample buffer offered", () => {
  const attributes = stub().getContextAttributes() as Record<string, unknown>;
  expect(attributes.antialias).toBe(false);
  expect(attributes.depth).toBe(true);
});

it("defines the `self` three's disposal path reaches for, once", () => {
  const host = globalThis as Record<string, unknown>;
  const before = host.self;
  try {
    delete host.self;
    defineSelfForThree();
    const defined = host.self as {
      requestAnimationFrame(): number;
      cancelAnimationFrame(): void;
    };
    expect(defined.requestAnimationFrame()).toBe(0);
    expect(defined.cancelAnimationFrame()).toBeUndefined();
    // A host that already defines one is left exactly as it was.
    defineSelfForThree();
    expect(host.self).toBe(defined);
  } finally {
    if (before === undefined) delete host.self;
    else host.self = before;
  }
});
