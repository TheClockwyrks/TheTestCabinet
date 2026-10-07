// Spectra — the second band, derived from the seeded art.

import { describe, expect, it } from "vitest";
import {
  ART,
  COLOR_TOLERANCE,
  exposedLayerBand,
  hexToRgb,
  keepCoreOnly,
  pixelIs,
  retintOneColor,
  retintToBand,
  swapBands,
} from "./assets";
import { SPRITE_SIZE } from "./constants";
import { BAND_COLOR } from "./theme";
import {
  realSprites,
  silhouetteAgreement,
  silhouetteOf,
} from "./art.test-support";

/** A one-pixel buffer carrying `rgb` at full alpha. */
function pixel(rgb: readonly [number, number, number]): Uint8ClampedArray {
  return new Uint8ClampedArray([rgb[0], rgb[1], rgb[2], 255]);
}

describe("the pixel edits", () => {
  it("reads a hex colour as a triple", () => {
    expect(hexToRgb("#34e2ff")).toEqual([0x34, 0xe2, 0xff]);
    expect(hexToRgb("ff4ec7")).toEqual([0xff, 0x4e, 0xc7]);
  });

  it("matches a colour within its tolerance and not beyond it", () => {
    const near = pixel([ART.cyan[0] + 4, ART.cyan[1] - 4, ART.cyan[2]]);
    expect(pixelIs(near, 0, ART.cyan)).toBe(true);
    expect(pixelIs(pixel(ART.magenta), 0, ART.cyan)).toBe(false);
    const far = pixel([
      ART.cyan[0] + COLOR_TOLERANCE + 20,
      ART.cyan[1],
      ART.cyan[2],
    ]);
    expect(pixelIs(far, 0, ART.cyan)).toBe(false);
  });

  it("retints both band colours to one, and leaves everything else", () => {
    const data = new Uint8ClampedArray([
      ...pixel(ART.cyan),
      ...pixel(ART.magenta),
      ...pixel([255, 255, 255]),
      0,
      0,
      0,
      0,
    ]);
    retintToBand(data, "magenta");
    const target = hexToRgb(BAND_COLOR.magenta);
    expect([data[0], data[1], data[2]]).toEqual([...target]);
    expect([data[4], data[5], data[6]]).toEqual([...target]);
    expect([data[8], data[9], data[10]]).toEqual([255, 255, 255]);
    // A fully transparent pixel is never written.
    expect([data[12], data[13], data[14]]).toEqual([0, 0, 0]);
  });

  it("retints one named colour alone", () => {
    const data = new Uint8ClampedArray([
      ...pixel(ART.cyan),
      ...pixel([0xea, 0xf0, 0xfb]),
    ]);
    retintOneColor(data, ART.cyan, "magenta");
    expect([data[0], data[1], data[2]]).toEqual([
      ...hexToRgb(BAND_COLOR.magenta),
    ]);
    expect([data[4], data[5], data[6]]).toEqual([0xea, 0xf0, 0xfb]);
  });

  it("swaps the two bands for one another", () => {
    const data = new Uint8ClampedArray([
      ...pixel(ART.cyan),
      ...pixel(ART.magenta),
    ]);
    swapBands(data);
    expect([data[0], data[1], data[2]]).toEqual([
      ...hexToRgb(BAND_COLOR.magenta),
    ]);
    expect([data[4], data[5], data[6]]).toEqual([...hexToRgb(BAND_COLOR.cyan)]);
  });

  it("keeps only what the flood from the centre can reach", () => {
    // A 5x5 field: a core pixel at the centre, a ring of gap around it, and a shell
    // pixel in the corner. Only the centre survives.
    const size = 5;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let index = 0; index < size * size; index += 1) {
      const at = index * 4;
      const x = index % size;
      const y = (index - x) / size;
      const rgb =
        x === 2 && y === 2
          ? ART.magenta
          : Math.abs(x - 2) <= 1 && Math.abs(y - 2) <= 1
            ? ART.gap
            : ART.cyan;
      data[at] = rgb[0];
      data[at + 1] = rgb[1];
      data[at + 2] = rgb[2];
      data[at + 3] = 255;
    }
    keepCoreOnly(data, size, size, ART.cyan);
    let opaque = 0;
    for (let index = 0; index < size * size; index += 1) {
      if (data[index * 4 + 3] > 0) opaque += 1;
    }
    expect(opaque).toBe(1);
  });

  it("names the band of a Prism's exposed layer", () => {
    expect(exposedLayerBand("cyan", true)).toBe("cyan");
    expect(exposedLayerBand("cyan", false)).toBe("magenta");
  });
});

describe("the derived band-states of the real art", () => {
  it("gives both bands of every element one silhouette", async () => {
    const sprites = await realSprites();
    for (const pair of [
      sprites.fighter,
      sprites.shard,
      sprites.fluxHeld,
    ] as const) {
      const cyan = silhouetteOf(pair.cyan);
      const magenta = silhouetteOf(pair.magenta);
      expect(silhouetteAgreement(cyan, magenta)).toBe(1);
    }
    const shell = silhouetteOf(sprites.prismShell.cyan);
    expect(
      silhouetteAgreement(shell, silhouetteOf(sprites.prismShell.magenta)),
    ).toBe(1);
  });

  it("keeps a Flux's shimmer state as the seeded file itself", async () => {
    const sprites = await realSprites();
    expect(
      silhouetteAgreement(
        silhouetteOf(sprites.fluxShimmer),
        silhouetteOf(sprites.fluxHeld.cyan),
      ),
    ).toBe(1);
  });

  it("lifts a Prism's core out as a strictly smaller silhouette", async () => {
    const sprites = await realSprites();
    const count = (bits: Uint8Array): number =>
      bits.reduce((sum, bit) => sum + bit, 0);
    const shell = count(silhouetteOf(sprites.prismShell.cyan));
    const core = count(silhouetteOf(sprites.prismCore.cyan));
    expect(core).toBeGreaterThan(0);
    expect(core).toBeLessThan(shell * 0.7);
    // Every kept pixel of the core lies inside the shell's own silhouette.
    const shellBits = silhouetteOf(sprites.prismShell.cyan);
    const coreBits = silhouetteOf(sprites.prismCore.cyan);
    for (let index = 0; index < coreBits.length; index += 1) {
      if (coreBits[index] === 1) expect(shellBits[index]).toBe(1);
    }
  });

  it("bakes every source at the seeded sprite size", async () => {
    const sprites = await realSprites();
    expect(silhouetteOf(sprites.shard.cyan)).toHaveLength(
      SPRITE_SIZE * SPRITE_SIZE,
    );
  });
});
