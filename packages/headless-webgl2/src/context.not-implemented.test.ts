import { describe, expect, it } from "vitest";
import { createCanvas } from "./index";
import type { HeadlessWebGL2 } from "./index";

/**
 * The loud-refusal contract: every WebGL2 method outside the stage-1 surface
 * exists on the context and throws an Error naming itself and the subset —
 * never a silent no-op — and the implemented methods throw the same way for
 * enums whose features are excluded. The lists below intentionally duplicate
 * the context's own stub tables: the duplication is the test, proving the
 * whole surface exists by name rather than trusting the table it came from.
 */

function makeGl(): HeadlessWebGL2 {
  return createCanvas(4, 4).getContext("webgl2");
}

/** The context as a plain method bag, for names the public type deliberately omits. */
function methods(
  gl: HeadlessWebGL2,
): Record<string, (...args: unknown[]) => unknown> {
  return gl as unknown as Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Methods stage 3 promoted from the deferred list to real implementations;
 * the suite proves the stubs are gone (a call may latch a GL error, but it
 * must not throw the "not implemented yet" refusal).
 */
const FORMERLY_DEFERRED_METHODS = [
  "drawArrays",
  "drawElements",
  "texSubImage2D",
  "texStorage2D",
] as const;

/** Methods outside the 0.1.0 subset altogether. */
const OUT_OF_SUBSET_METHODS = [
  "bindFramebuffer",
  "bindRenderbuffer",
  "checkFramebufferStatus",
  "createFramebuffer",
  "createRenderbuffer",
  "deleteFramebuffer",
  "deleteRenderbuffer",
  "framebufferRenderbuffer",
  "framebufferTexture2D",
  "framebufferTextureLayer",
  "getFramebufferAttachmentParameter",
  "getRenderbufferParameter",
  "isFramebuffer",
  "isRenderbuffer",
  "renderbufferStorage",
  "renderbufferStorageMultisample",
  "blitFramebuffer",
  "invalidateFramebuffer",
  "invalidateSubFramebuffer",
  "readBuffer",
  "drawBuffers",
  "clearBufferfv",
  "clearBufferiv",
  "clearBufferuiv",
  "clearBufferfi",
  "getInternalformatParameter",
  "clearStencil",
  "stencilFunc",
  "stencilFuncSeparate",
  "stencilMask",
  "stencilMaskSeparate",
  "stencilOp",
  "stencilOpSeparate",
  "sampleCoverage",
  "generateMipmap",
  "copyBufferSubData",
  "getBufferSubData",
  "copyTexImage2D",
  "copyTexSubImage2D",
  "copyTexSubImage3D",
  "compressedTexImage2D",
  "compressedTexSubImage2D",
  "compressedTexImage3D",
  "compressedTexSubImage3D",
  "texImage3D",
  "texSubImage3D",
  "texStorage3D",
  "createSampler",
  "deleteSampler",
  "isSampler",
  "bindSampler",
  "samplerParameteri",
  "samplerParameterf",
  "getSamplerParameter",
  "vertexAttribDivisor",
  "drawArraysInstanced",
  "drawElementsInstanced",
  "drawRangeElements",
  "vertexAttribIPointer",
  "vertexAttribI4i",
  "vertexAttribI4iv",
  "vertexAttribI4ui",
  "vertexAttribI4uiv",
  "uniform1ui",
  "uniform2ui",
  "uniform3ui",
  "uniform4ui",
  "uniform1uiv",
  "uniform2uiv",
  "uniform3uiv",
  "uniform4uiv",
  "uniformMatrix2fv",
  "uniformMatrix2x3fv",
  "uniformMatrix2x4fv",
  "uniformMatrix3x2fv",
  "uniformMatrix3x4fv",
  "uniformMatrix4x2fv",
  "uniformMatrix4x3fv",
  "bindBufferBase",
  "bindBufferRange",
  "getIndexedParameter",
  "getUniformIndices",
  "getActiveUniforms",
  "getUniformBlockIndex",
  "getActiveUniformBlockParameter",
  "getActiveUniformBlockName",
  "uniformBlockBinding",
  "createQuery",
  "deleteQuery",
  "isQuery",
  "beginQuery",
  "endQuery",
  "getQuery",
  "getQueryParameter",
  "fenceSync",
  "isSync",
  "deleteSync",
  "clientWaitSync",
  "waitSync",
  "getSyncParameter",
  "createTransformFeedback",
  "deleteTransformFeedback",
  "isTransformFeedback",
  "bindTransformFeedback",
  "beginTransformFeedback",
  "endTransformFeedback",
  "pauseTransformFeedback",
  "resumeTransformFeedback",
  "transformFeedbackVaryings",
  "getTransformFeedbackVarying",
  "getFragDataLocation",
] as const;

describe("methods promoted out of the deferred list by stage 3", () => {
  it("are real implementations now: calling one latches a GL error at worst, never the stub throw", () => {
    const gl = makeGl();
    const bag = methods(gl);
    for (const name of FORMERLY_DEFERRED_METHODS) {
      expect(typeof bag[name], name).toBe("function");
    }
    // Each call below is a misuse (no program, no texture image), so the
    // honest response is a latched GL error — proof the stub is gone.
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 0);
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
      new Uint8Array(4),
    );
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    expect(gl.getError()).toBe(gl.INVALID_OPERATION);
  });
});

describe("methods outside the subset", () => {
  it("exist and throw an Error naming the method and the subset, never silently no-oping", () => {
    const gl = methods(makeGl());
    for (const name of OUT_OF_SUBSET_METHODS) {
      expect(typeof gl[name], name).toBe("function");
      expect(() => gl[name]!(), name).toThrow(Error);
      expect(() => gl[name]!(), name).toThrow(
        new RegExp(`headless-webgl2: ${name} is not implemented`),
      );
      expect(() => gl[name]!(), name).toThrow(
        /outside the 0\.1\.0 WebGL2 subset/,
      );
    }
  });
});

describe("excluded enums reaching implemented methods", () => {
  it("throws for a buffer target outside ARRAY_BUFFER and ELEMENT_ARRAY_BUFFER", () => {
    const gl = makeGl();
    expect(() => gl.bindBuffer(gl.UNIFORM_BUFFER, null)).toThrow(
      /bindBuffer\(UNIFORM_BUFFER\) is not implemented/,
    );
    expect(() => gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null)).toThrow(
      /PIXEL_UNPACK_BUFFER/,
    );
  });

  it("throws for a texture target outside TEXTURE_2D", () => {
    const gl = makeGl();
    expect(() => gl.bindTexture(gl.TEXTURE_CUBE_MAP, null)).toThrow(
      /bindTexture\(TEXTURE_CUBE_MAP\) is not implemented/,
    );
    expect(() => gl.bindTexture(gl.TEXTURE_3D, null)).toThrow(/TEXTURE_3D/);
  });

  it("throws for capabilities of excluded features", () => {
    const gl = makeGl();
    expect(() => gl.enable(gl.RASTERIZER_DISCARD)).toThrow(
      /enable\(RASTERIZER_DISCARD\) is not implemented/,
    );
    expect(() => gl.disable(gl.SAMPLE_COVERAGE)).toThrow(/SAMPLE_COVERAGE/);
  });

  it("throws for a mipmapped min filter, mipmaps being outside 0.1.0", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    expect(() =>
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      ),
    ).toThrow(/mipmap/);
  });

  it("throws for a mip level above zero in texImage2D", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    expect(() =>
      gl.texImage2D(
        gl.TEXTURE_2D,
        1,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      ),
    ).toThrow(/mip level/);
  });

  it("throws for float texture uploads", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    expect(() =>
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        1,
        1,
        0,
        gl.RGBA,
        gl.FLOAT,
        null,
      ),
    ).toThrow(/pixel type other than UNSIGNED_BYTE/);
  });

  it("throws for the DOM-source overload of texImage2D, naming the ArrayBufferView route", () => {
    const gl = makeGl();
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    expect(() =>
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, {}),
    ).toThrow(/ArrayBufferView overload/);
  });

  it("throws for a stencil clear, no stencil buffer being allocated", () => {
    const gl = makeGl();
    expect(() => gl.clear(gl.STENCIL_BUFFER_BIT)).toThrow(/STENCIL_BUFFER_BIT/);
  });

  it("throws for the MIN and MAX blend equations", () => {
    const gl = makeGl();
    expect(() => gl.blendEquation(gl.MIN)).toThrow(
      /blendEquation\(MIN \| MAX\)/,
    );
  });

  it("throws for integer vertex fetch types", () => {
    const gl = makeGl();
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    expect(() => gl.vertexAttribPointer(0, 3, gl.INT, false, 0, 0)).toThrow(
      /INT\/UNSIGNED_INT/,
    );
  });

  it("throws for the WebGL2 row-length and skip pixel-store parameters", () => {
    const gl = makeGl();
    expect(() => gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 8)).toThrow(
      /row-length\/skip/,
    );
  });
});
