import { describe, expect, it } from "vitest";
import { GL } from "./constants";
import { createCanvas } from "./index";

/**
 * Spot checks against the Khronos IDL values plus the structural guarantees:
 * the table is broad, and every entry is readable straight off a live context
 * the way validator code reads `gl.RGBA`.
 */

describe("the GL constant table", () => {
  it("carries the Khronos IDL values for the constants validators lean on", () => {
    expect(GL.COLOR_BUFFER_BIT).toBe(0x4000);
    expect(GL.DEPTH_BUFFER_BIT).toBe(0x100);
    expect(GL.TRIANGLES).toBe(0x0004);
    expect(GL.RGBA).toBe(0x1908);
    expect(GL.UNSIGNED_BYTE).toBe(0x1401);
    expect(GL.FLOAT).toBe(0x1406);
    expect(GL.ARRAY_BUFFER).toBe(0x8892);
    expect(GL.ELEMENT_ARRAY_BUFFER).toBe(0x8893);
    expect(GL.TEXTURE_2D).toBe(0x0de1);
    expect(GL.TEXTURE0).toBe(0x84c0);
    expect(GL.TEXTURE31).toBe(0x84df);
    expect(GL.VERTEX_SHADER).toBe(0x8b31);
    expect(GL.FRAGMENT_SHADER).toBe(0x8b30);
    expect(GL.DEPTH_TEST).toBe(0x0b71);
    expect(GL.LEQUAL).toBe(0x0203);
    expect(GL.SRC_ALPHA).toBe(0x0302);
    expect(GL.ONE_MINUS_SRC_ALPHA).toBe(0x0303);
    expect(GL.NEAREST).toBe(0x2600);
    expect(GL.LINEAR).toBe(0x2601);
    expect(GL.CLAMP_TO_EDGE).toBe(0x812f);
    expect(GL.NO_ERROR).toBe(0);
    expect(GL.INVALID_ENUM).toBe(0x0500);
    expect(GL.INVALID_VALUE).toBe(0x0501);
    expect(GL.INVALID_OPERATION).toBe(0x0502);
    expect(GL.DEPTH24_STENCIL8).toBe(0x88f0);
    expect(GL.RGBA8).toBe(0x8058);
    expect(GL.R8).toBe(0x8229);
    expect(GL.HALF_FLOAT).toBe(0x140b);
    expect(GL.VERTEX_ARRAY_BINDING).toBe(0x85b5);
    expect(GL.UNPACK_FLIP_Y_WEBGL).toBe(0x9240);
    expect(GL.INVALID_INDEX).toBe(0xffffffff);
    expect(GL.TIMEOUT_IGNORED).toBe(-1);
  });

  it("is broad — hundreds of entries, not a hand-picked few", () => {
    // Complete coverage is the design; a shrinking table is a regression.
    expect(Object.keys(GL).length).toBeGreaterThan(450);
  });

  it("appears in full on a live context, so gl.RGBA-style reads work as in a browser", () => {
    const gl = createCanvas(2, 2).getContext("webgl2");
    const glAsTable = gl as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(GL)) {
      expect(glAsTable[name], name).toBe(value);
    }
  });
});
