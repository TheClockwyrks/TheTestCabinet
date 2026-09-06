// Spectra — the seeded art, decoded for this build's own tests.
//
// `src/assets.ts` bakes each band-state through a browser canvas. A test has no
// document, so this file does the same derivation through `@napi-rs/canvas` — the
// same pure pixel functions over the files the case seeded, which is the point: what a
// test measures is the art the game actually draws, not a stand-in for it.

import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  ART,
  hexToRgb,
  keepCoreOnly,
  retintOneColor,
  retintToBand,
  swapBands,
  type Sprites,
} from "./assets";
import { BAND_COLOR } from "./theme";
import { SPRITE_SIZE, SPRITES } from "./constants";
import type { Band } from "./types";

/** One seeded sprite, decoded and edited into a `SPRITE_SIZE` square canvas. */
async function bake(
  file: string,
  edit: (data: Uint8ClampedArray) => void,
): Promise<CanvasImageSource> {
  const image = await loadImage(new URL(`../assets/${file}`, import.meta.url));
  const canvas = createCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const pixels = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  edit(pixels.data as unknown as Uint8ClampedArray);
  ctx.putImageData(pixels, 0, 0);
  return canvas as unknown as CanvasImageSource;
}

/** The seeded art with every band-state derived, exactly as the build derives it. */
export async function realSprites(): Promise<Sprites> {
  const bands: readonly Band[] = ["cyan", "magenta"];
  const prismShell = {} as Record<Band, CanvasImageSource>;
  const prismCore = {} as Record<Band, CanvasImageSource>;
  for (const band of bands) {
    prismShell[band] = await bake(SPRITES.prism, (data) => {
      if (band === "magenta") swapBands(data);
    });
    prismCore[band] = await bake(SPRITES.prism, (data) => {
      if (band === "magenta") swapBands(data);
      keepCoreOnly(data, SPRITE_SIZE, SPRITE_SIZE, hexToRgb(BAND_COLOR[band]));
    });
  }
  return {
    fighter: {
      cyan: await bake(SPRITES.fighter, (data) =>
        retintOneColor(data, ART.cyan, "cyan"),
      ),
      magenta: await bake(SPRITES.fighter, (data) =>
        retintOneColor(data, ART.cyan, "magenta"),
      ),
    },
    shard: {
      cyan: await bake(SPRITES.shard, (data) => retintToBand(data, "cyan")),
      magenta: await bake(SPRITES.shard, (data) =>
        retintToBand(data, "magenta"),
      ),
    },
    fluxHeld: {
      cyan: await bake(SPRITES.flux, (data) => retintToBand(data, "cyan")),
      magenta: await bake(SPRITES.flux, (data) =>
        retintToBand(data, "magenta"),
      ),
    },
    fluxShimmer: await bake(SPRITES.flux, () => undefined),
    prismShell,
    prismCore,
    burst: null,
  };
}

/** The alpha silhouette of one decoded source, as one bit per pixel. */
export function silhouetteOf(source: CanvasImageSource): Uint8Array {
  const canvas = createCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source as never, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const { data } = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const bits = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE);
  for (let index = 0; index < bits.length; index += 1) {
    bits[index] = data[index * 4 + 3] > 8 ? 1 : 0;
  }
  return bits;
}

/** How many pixels of two silhouettes agree, as a fraction of the whole square. */
export function silhouetteAgreement(a: Uint8Array, b: Uint8Array): number {
  let same = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) same += 1;
  }
  return same / a.length;
}
