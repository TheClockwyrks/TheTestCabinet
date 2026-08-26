import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * The fixed-function state machine and the error latch: what `getError`
 * reports, what `getParameter` answers, and how each state setter validates.
 * Object stores (buffers, VAOs, textures, shaders, programs) are covered in
 * objects.test.ts; clearing and readback in raster/framebuffer.test.ts.
 */

/** An 8×8 context with default attributes, the fixture nearly every test wants. */
function makeGl(): HeadlessWebGL2 {
  return createCanvas(8, 8).getContext("webgl2");
}

describe("the error latch", () => {
  it("reports NO_ERROR on a fresh context", () => {
    expect(makeGl().getError()).toBe(0);
  });

  it("latches one flag per error code and clears it on read", () => {
    const gl = makeGl();
    gl.enable(0xdead); // not a capability
    gl.enable(0xdead); // the duplicate is dropped while the first is unread
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });

  it("retains distinct codes and hands them back oldest first", () => {
    const gl = makeGl();
    gl.enable(0xdead); // INVALID_ENUM
    gl.lineWidth(0); // INVALID_VALUE
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });
});

describe("capabilities", () => {
  it("toggles the implemented capabilities through enable, disable, and isEnabled", () => {
    const gl = makeGl();
    expect(gl.isEnabled(gl.DEPTH_TEST)).toBe(false);
    gl.enable(gl.DEPTH_TEST);
    expect(gl.isEnabled(gl.DEPTH_TEST)).toBe(true);
    gl.disable(gl.DEPTH_TEST);
    expect(gl.isEnabled(gl.DEPTH_TEST)).toBe(false);
  });

  it("starts with DITHER enabled and everything else disabled, the GL initial state", () => {
    const gl = makeGl();
    expect(gl.isEnabled(gl.DITHER)).toBe(true);
    for (const cap of [gl.BLEND, gl.CULL_FACE, gl.DEPTH_TEST, gl.SCISSOR_TEST, gl.POLYGON_OFFSET_FILL, gl.STENCIL_TEST]) {
      expect(gl.isEnabled(cap)).toBe(false);
    }
  });

  it("latches INVALID_ENUM for a capability that does not exist", () => {
    const gl = makeGl();
    gl.enable(0x1234);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.isEnabled(0x1234)).toBe(false);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });
});

describe("getParameter", () => {
  it("names the implementation through the identity strings", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.VERSION)).toBe("WebGL 2.0 (headless-webgl2)");
    expect(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)).toBe("WebGL GLSL ES 3.00 (headless-webgl2)");
    expect(gl.getParameter(gl.VENDOR)).toBe("test-cabinet");
    expect(gl.getParameter(gl.RENDERER)).toBe("headless-webgl2 software");
  });

  it("answers the documented implementation limits", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.MAX_TEXTURE_SIZE)).toBe(4096);
    expect(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)).toBe(16);
    expect(gl.getParameter(gl.MAX_VERTEX_ATTRIBS)).toBe(16);
    expect(gl.getParameter(gl.MAX_VARYING_VECTORS)).toBe(15);
    expect(gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)).toBe(1024);
    expect(gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)).toBe(1024);
    expect([...(gl.getParameter(gl.ALIASED_LINE_WIDTH_RANGE) as Float32Array)]).toEqual([1, 1]);
  });

  it("reports the guaranteed readPixels format for the default framebuffer", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT)).toBe(gl.RGBA);
    expect(gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE)).toBe(gl.UNSIGNED_BYTE);
  });

  it("reports channel depths that follow the context attributes", () => {
    const withAlpha = makeGl();
    expect(withAlpha.getParameter(withAlpha.ALPHA_BITS)).toBe(8);
    expect(withAlpha.getParameter(withAlpha.DEPTH_BITS)).toBe(24);
    expect(withAlpha.getParameter(withAlpha.STENCIL_BITS)).toBe(0);
    const opaque = createCanvas(2, 2).getContext("webgl2", { alpha: false, depth: false });
    expect(opaque.getParameter(opaque.ALPHA_BITS)).toBe(0);
    expect(opaque.getParameter(opaque.DEPTH_BITS)).toBe(0);
  });

  it("latches INVALID_ENUM and answers null for an unknown pname", () => {
    const gl = makeGl();
    expect(gl.getParameter(0xbeef)).toBeNull();
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("hands back fresh array copies, so a caller cannot mutate state through them", () => {
    const gl = makeGl();
    const value = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    value[0] = 0.5;
    expect((gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)[0]).toBe(0);
  });
});

describe("viewport and scissor state", () => {
  it("starts both boxes at the full drawing buffer, the context-creation rule", () => {
    const gl = makeGl();
    expect([...(gl.getParameter(gl.VIEWPORT) as Int32Array)]).toEqual([0, 0, 8, 8]);
    expect([...(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)]).toEqual([0, 0, 8, 8]);
  });

  it("stores what viewport and scissor are given, truncated to integers", () => {
    const gl = makeGl();
    gl.viewport(1, 2, 3.9, 4.2);
    expect([...(gl.getParameter(gl.VIEWPORT) as Int32Array)]).toEqual([1, 2, 3, 4]);
    gl.scissor(-1, 0, 2, 2);
    expect([...(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)]).toEqual([-1, 0, 2, 2]);
  });

  it("refuses a negative extent with INVALID_VALUE and keeps the prior box", () => {
    const gl = makeGl();
    gl.viewport(0, 0, -1, 4);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect([...(gl.getParameter(gl.VIEWPORT) as Int32Array)]).toEqual([0, 0, 8, 8]);
    gl.scissor(0, 0, 4, -1);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect([...(gl.getParameter(gl.SCISSOR_BOX) as Int32Array)]).toEqual([0, 0, 8, 8]);
  });
});

describe("clear values and masks", () => {
  it("clamps clear color and depth on set, the values queries then answer", () => {
    const gl = makeGl();
    gl.clearColor(2, -1, 0.5, Number.NaN);
    expect([...(gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array)]).toEqual([1, 0, 0.5, 0]);
    gl.clearDepth(3);
    expect(gl.getParameter(gl.DEPTH_CLEAR_VALUE)).toBe(1);
  });

  it("stores color and depth write masks", () => {
    const gl = makeGl();
    gl.colorMask(false, true, false, true);
    expect(gl.getParameter(gl.COLOR_WRITEMASK)).toEqual([false, true, false, true]);
    gl.depthMask(false);
    expect(gl.getParameter(gl.DEPTH_WRITEMASK)).toBe(false);
  });
});

describe("depth state", () => {
  it("stores a valid depth function and starts at LESS", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.DEPTH_FUNC)).toBe(gl.LESS);
    gl.depthFunc(gl.GEQUAL);
    expect(gl.getParameter(gl.DEPTH_FUNC)).toBe(gl.GEQUAL);
  });

  it("latches INVALID_ENUM for a bad depth function and keeps the prior one", () => {
    const gl = makeGl();
    gl.depthFunc(0x1111);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getParameter(gl.DEPTH_FUNC)).toBe(gl.LESS);
  });

  it("clamps the depth range to the unit interval", () => {
    const gl = makeGl();
    gl.depthRange(-0.5, 2);
    expect([...(gl.getParameter(gl.DEPTH_RANGE) as Float32Array)]).toEqual([0, 1]);
  });
});

describe("blend state", () => {
  it("starts at ONE/ZERO with FUNC_ADD, the GL initial state", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.ONE);
    expect(gl.getParameter(gl.BLEND_DST_RGB)).toBe(gl.ZERO);
    expect(gl.getParameter(gl.BLEND_EQUATION_RGB)).toBe(gl.FUNC_ADD);
  });

  it("stores blendFunc across both channel pairs and blendFuncSeparate independently", () => {
    const gl = makeGl();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    expect(gl.getParameter(gl.BLEND_SRC_ALPHA)).toBe(gl.SRC_ALPHA);
    expect(gl.getParameter(gl.BLEND_DST_ALPHA)).toBe(gl.ONE_MINUS_SRC_ALPHA);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.ONE);
    expect(gl.getParameter(gl.BLEND_SRC_ALPHA)).toBe(gl.ZERO);
  });

  it("refuses an unknown blend factor with INVALID_ENUM, leaving all four factors unchanged", () => {
    const gl = makeGl();
    gl.blendFunc(0x9999, gl.ONE);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.ONE);
    expect(gl.getParameter(gl.BLEND_DST_RGB)).toBe(gl.ZERO);
  });

  it("stores the three implemented blend equations", () => {
    const gl = makeGl();
    gl.blendEquationSeparate(gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT);
    expect(gl.getParameter(gl.BLEND_EQUATION_RGB)).toBe(gl.FUNC_SUBTRACT);
    expect(gl.getParameter(gl.BLEND_EQUATION_ALPHA)).toBe(gl.FUNC_REVERSE_SUBTRACT);
  });

  it("clamps the constant blend color", () => {
    const gl = makeGl();
    gl.blendColor(0.25, 2, -1, 0.5);
    expect([...(gl.getParameter(gl.BLEND_COLOR) as Float32Array)]).toEqual([0.25, 1, 0, 0.5]);
  });
});

describe("culling, lines, and polygon offset", () => {
  it("stores cull face and winding, starting at BACK and CCW", () => {
    const gl = makeGl();
    expect(gl.getParameter(gl.CULL_FACE_MODE)).toBe(gl.BACK);
    expect(gl.getParameter(gl.FRONT_FACE)).toBe(gl.CCW);
    gl.cullFace(gl.FRONT_AND_BACK);
    gl.frontFace(gl.CW);
    expect(gl.getParameter(gl.CULL_FACE_MODE)).toBe(gl.FRONT_AND_BACK);
    expect(gl.getParameter(gl.FRONT_FACE)).toBe(gl.CW);
  });

  it("latches INVALID_ENUM for a bad cull mode or winding", () => {
    const gl = makeGl();
    gl.cullFace(0x1);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    gl.frontFace(0x1);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("accepts a positive line width and refuses zero, negatives, and NaN with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.lineWidth(3);
    expect(gl.getParameter(gl.LINE_WIDTH)).toBe(3);
    for (const bad of [0, -1, Number.NaN]) {
      gl.lineWidth(bad);
      expect(gl.getError()).toBe(gl.INVALID_VALUE);
    }
    expect(gl.getParameter(gl.LINE_WIDTH)).toBe(3);
  });

  it("stores polygon offset factor and units", () => {
    const gl = makeGl();
    gl.polygonOffset(1.5, 2);
    expect(gl.getParameter(gl.POLYGON_OFFSET_FACTOR)).toBe(1.5);
    expect(gl.getParameter(gl.POLYGON_OFFSET_UNITS)).toBe(2);
  });

  it("validates hints and otherwise ignores them", () => {
    const gl = makeGl();
    gl.hint(gl.GENERATE_MIPMAP_HINT, gl.NICEST);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    gl.hint(0x1234, gl.NICEST);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
    gl.hint(gl.GENERATE_MIPMAP_HINT, 0x1234);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });
});

describe("pixel store state", () => {
  it("accepts alignments of 1, 2, 4, and 8 and refuses others with INVALID_VALUE", () => {
    const gl = makeGl();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 8);
    expect(gl.getParameter(gl.UNPACK_ALIGNMENT)).toBe(8);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    expect(gl.getParameter(gl.PACK_ALIGNMENT)).toBe(1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 3);
    expect(gl.getError()).toBe(gl.INVALID_VALUE);
    expect(gl.getParameter(gl.UNPACK_ALIGNMENT)).toBe(8);
  });

  it("stores the flip-y and premultiply flags", () => {
    const gl = makeGl();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    expect(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)).toBe(true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    expect(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)).toBe(true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    expect(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)).toBe(false);
  });

  it("latches INVALID_ENUM for an unknown pixel store parameter", () => {
    const gl = makeGl();
    gl.pixelStorei(0x4321, 1);
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });
});

describe("extensions and precision", () => {
  it("supports no extensions and says so honestly", () => {
    const gl = makeGl();
    expect(gl.getSupportedExtensions()).toEqual([]);
    expect(gl.getExtension("OES_texture_float")).toBeNull();
    expect(gl.getExtension("EXT_color_buffer_float")).toBeNull();
  });

  it("answers highp-float-ish precision figures for shader boilerplate", () => {
    const gl = makeGl();
    expect(gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)).toEqual({ rangeMin: 127, rangeMax: 127, precision: 23 });
    expect(gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.MEDIUM_INT)).toEqual({ rangeMin: 31, rangeMax: 30, precision: 0 });
  });

  it("latches INVALID_ENUM for a bad precision query", () => {
    const gl = makeGl();
    expect(gl.getShaderPrecisionFormat(0x1, gl.HIGH_FLOAT)).toBeNull();
    expect(gl.getError()).toBe(gl.INVALID_ENUM);
  });

  it("treats flush and finish as completed no-ops", () => {
    const gl = makeGl();
    gl.flush();
    gl.finish();
    expect(gl.getError()).toBe(gl.NO_ERROR);
  });
});
