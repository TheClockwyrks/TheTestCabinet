import { describe, expect, it } from "vitest";
import { GL } from "../constants";
import { TextureObject, type TextureImage } from "../objects";
import { samplerFor } from "./texture";

/**
 * The sampler factory in isolation: completeness, filtering, wrap modes, and
 * format expansion over hand-built texture records. The plumb-through from a
 * shader's `texture()` call to these functions is the draw suite's business.
 */

/** A complete texture over the given image bytes, NEAREST unless told otherwise. */
function texture(width: number, height: number, format: number, channels: number, bytes: number[], filter: number = GL.NEAREST): TextureObject {
  const t = new TextureObject();
  const image: TextureImage = { width, height, internalFormat: format, format, type: GL.UNSIGNED_BYTE, channels, data: Uint8Array.from(bytes) };
  t.image = image;
  t.minFilter = filter;
  t.magFilter = filter;
  t.wrapS = GL.CLAMP_TO_EDGE;
  t.wrapT = GL.CLAMP_TO_EDGE;
  return t;
}

/* A 2×2 RGBA test card: red, green (bottom row); blue, white (top row). */
const CARD = texture(2, 2, GL.RGBA, 4, [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);

describe("completeness", () => {
  it("samples opaque black for an empty unit, matching an incomplete texture in a browser", () => {
    expect(Array.from(samplerFor(null)(0.5, 0.5, 0))).toEqual([0, 0, 0, 1]);
  });

  it("samples opaque black for a texture with no image uploaded", () => {
    expect(Array.from(samplerFor(new TextureObject())(0.5, 0.5, 0))).toEqual([0, 0, 0, 1]);
  });

  it("samples opaque black under the default mip-requiring min filter, because no mip chain can exist in 0.1.0", () => {
    const t = texture(1, 1, GL.RGBA, 4, [10, 20, 30, 40]);
    t.minFilter = GL.NEAREST_MIPMAP_LINEAR;
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([0, 0, 0, 1]);
  });
});

describe("NEAREST", () => {
  it("returns the texel under the coordinate byte-exactly", () => {
    const sample = samplerFor(CARD);
    expect(Array.from(sample(0.25, 0.25, 0))).toEqual([1, 0, 0, 1]);
    expect(Array.from(sample(0.75, 0.25, 0))).toEqual([0, 1, 0, 1]);
    expect(Array.from(sample(0.75, 0.75, 0))).toEqual([1, 1, 1, 1]);
  });

  it("clamps to the edge texel under CLAMP_TO_EDGE", () => {
    const sample = samplerFor(CARD);
    expect(Array.from(sample(-3, -3, 0))).toEqual([1, 0, 0, 1]);
    expect(Array.from(sample(9, 0.25, 0))).toEqual([0, 1, 0, 1]);
  });

  it("tiles under REPEAT, seam-exact across the wrap boundary", () => {
    const t = texture(2, 1, GL.RGBA, 4, [255, 0, 0, 255, 0, 255, 0, 255]);
    t.wrapS = GL.REPEAT;
    const sample = samplerFor(t);
    // u = 1.25 is a quarter into the next repetition: the first texel again.
    expect(Array.from(sample(1.25, 0.5, 0))).toEqual([1, 0, 0, 1]);
    expect(Array.from(sample(-0.25, 0.5, 0))).toEqual([0, 1, 0, 1]);
  });

  it("reflects under MIRRORED_REPEAT", () => {
    const t = texture(2, 1, GL.RGBA, 4, [255, 0, 0, 255, 0, 255, 0, 255]);
    t.wrapS = GL.MIRRORED_REPEAT;
    const sample = samplerFor(t);
    // u = 1.25 sits in the mirrored copy: the second texel reflected back.
    expect(Array.from(sample(1.25, 0.5, 0))).toEqual([0, 1, 0, 1]);
    expect(Array.from(sample(1.75, 0.5, 0))).toEqual([1, 0, 0, 1]);
  });

  it("treats a non-finite coordinate as zero rather than reading garbage", () => {
    expect(Array.from(samplerFor(CARD)(Number.NaN, 0.25, 0))).toEqual([1, 0, 0, 1]);
  });
});

describe("LINEAR", () => {
  it("returns the texel value exactly at a texel center, because both fractions are zero there", () => {
    const t = texture(2, 2, GL.RGBA, 4, [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255], GL.LINEAR);
    // Texel (0, 0)'s center is (0.25, 0.25) in normalized coordinates.
    expect(Array.from(samplerFor(t)(0.25, 0.25, 0))).toEqual([1, 0, 0, 1]);
    expect(Array.from(samplerFor(t)(0.75, 0.75, 0))).toEqual([1, 1, 1, 1]);
  });

  it("blends the two neighbors halfway between their centers", () => {
    const t = texture(2, 1, GL.RGBA, 4, [0, 0, 0, 255, 255, 255, 255, 255], GL.LINEAR);
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it("blends across the REPEAT seam using the wrapped neighbor", () => {
    const t = texture(2, 1, GL.RGBA, 4, [0, 0, 0, 255, 255, 255, 255, 255], GL.LINEAR);
    t.wrapS = GL.REPEAT;
    // u = 1.0: halfway between the last texel's center and the first's again.
    expect(Array.from(samplerFor(t)(1, 0.5, 0))).toEqual([0.5, 0.5, 0.5, 1]);
  });
});

describe("format expansion", () => {
  it("fills alpha with 1 for RGB", () => {
    const t = texture(1, 1, GL.RGB, 3, [255, 128, 0]);
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([1, 128 / 255, 0, 1]);
  });

  it("fills green and blue with 0 for RED", () => {
    const t = texture(1, 1, GL.RED, 1, [128]);
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([128 / 255, 0, 0, 1]);
  });

  it("broadcasts LUMINANCE to rgb with alpha 1", () => {
    const t = texture(1, 1, GL.LUMINANCE, 1, [51]);
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([0.2, 0.2, 0.2, 1]);
  });

  it("broadcasts LUMINANCE_ALPHA to rgb with the second byte as alpha", () => {
    const t = texture(1, 1, GL.LUMINANCE_ALPHA, 2, [51, 255]);
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([0.2, 0.2, 0.2, 1]);
  });

  it("carries only alpha for ALPHA", () => {
    const t = texture(1, 1, GL.ALPHA, 1, [51]);
    expect(Array.from(samplerFor(t)(0.5, 0.5, 0))).toEqual([0, 0, 0, 0.2]);
  });
});

describe("the reused result view", () => {
  it("hands back the same view per sampler, the emitter's copy-out contract", () => {
    const sample = samplerFor(CARD);
    const first = sample(0.25, 0.25, 0);
    const second = sample(0.75, 0.25, 0);
    expect(second).toBe(first);
    expect(Array.from(second)).toEqual([0, 1, 0, 1]);
  });
});
