// Spectra — loading the seeded art the project ships.
//
// Part of the runtime layer, and the whole of it that touches the network. Four
// PNGs and one particle system sit flat under `assets/` (specs/assets.md), and
// this module turns each file name into something the game can draw or play.
//
// EVERY URL RESOLVES AGAINST THE PAGE. A file is asked for by the bare name
// `specs/assets.md` gives it, resolved against `document.baseURI` — never as a
// root-absolute `/assets/...` — so the produced site runs unchanged at the root
// of a static host and under a sub-path of it. `vite.config.ts` serves that tree
// from the project root in development and copies it into `dist/assets/` when the
// site is built, so the same name reaches the same file either way.
//
// The band-states are derived from the decoded pixels by `src/art.ts`; this file
// only decodes, rasterizes, and hands the derived rasters back as canvases
// `drawImage` accepts.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";

import {
  deriveArt,
  type ArtRasters,
  type Raster,
  type SpriteRasters,
} from "./art";
import { BURST_SYSTEM, SPRITE_SIZE, SPRITES } from "./constants";
import type { Art } from "./types";

/** The folder every seeded file sits directly in. */
export const ASSET_ROOT = "assets";

/** The page-relative URL of one seeded file, by the name `assets/` gives it. */
export function assetUrl(file: string): string {
  return new URL(`${ASSET_ROOT}/${file}`, document.baseURI).href;
}

/** Decode one image, failing loudly enough to name the file that went missing. */
function loadImage(file: string): Promise<HTMLImageElement> {
  const url = assetUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error(`Spectra: failed to load ${url}`)),
    );
    image.src = url;
  });
}

/** The seeded drone-burst system, fetched page-relative and parsed. */
export async function loadBurstSystem(): Promise<ParticleSystem> {
  const url = assetUrl(BURST_SYSTEM);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Spectra: failed to load ${url} (${response.status})`);
  }
  return (await response.json()) as ParticleSystem;
}

/** A fresh offscreen canvas of `size` square, with smoothing off. */
function scratch(size: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null) {
    throw new Error("Spectra: an offscreen canvas has no 2D context");
  }
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

/** One decoded sprite's pixels, on the seeded `SPRITE_SIZE` square. */
function rasterize(image: HTMLImageElement): Raster {
  const { ctx } = scratch(SPRITE_SIZE);
  ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  ctx.drawImage(image, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
  return ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
}

/** One derived raster as a canvas `drawImage` accepts. */
function toCanvas(raster: Raster): HTMLCanvasElement {
  const { canvas, ctx } = scratch(raster.width);
  canvas.height = raster.height;
  // The raster is copied into a fresh buffer: `ImageData` insists on a plain
  // `ArrayBuffer` behind the view, and a derived raster's may be anything.
  ctx.putImageData(
    new ImageData(
      new Uint8ClampedArray(raster.data),
      raster.width,
      raster.height,
    ),
    0,
    0,
  );
  return canvas;
}

/** Every band-state of the derived art, as canvases. */
export function toSprites(rasters: ArtRasters): Omit<Art, "burst"> {
  return {
    fighter: {
      cyan: toCanvas(rasters.fighter.cyan),
      magenta: toCanvas(rasters.fighter.magenta),
    },
    shard: {
      cyan: toCanvas(rasters.shard.cyan),
      magenta: toCanvas(rasters.shard.magenta),
    },
    fluxHeld: {
      cyan: toCanvas(rasters.fluxHeld.cyan),
      magenta: toCanvas(rasters.fluxHeld.magenta),
    },
    fluxShimmer: toCanvas(rasters.fluxShimmer),
    prismFull: {
      cyan: toCanvas(rasters.prismFull.cyan),
      magenta: toCanvas(rasters.prismFull.magenta),
    },
    prismCore: {
      cyan: toCanvas(rasters.prismCore.cyan),
      magenta: toCanvas(rasters.prismCore.magenta),
    },
  };
}

/**
 * Decode the four seeded sprites, derive both band-states of each, and fetch the
 * seeded burst system.
 *
 * Awaited before the runtime is stood up, because a game handed a half-decoded
 * sprite draws nothing and gives no hint why.
 */
export async function loadArt(): Promise<Art> {
  const [fighter, shard, flux, prism, burst] = await Promise.all([
    loadImage(SPRITES.fighter),
    loadImage(SPRITES.shard),
    loadImage(SPRITES.flux),
    loadImage(SPRITES.prism),
    loadBurstSystem(),
  ]);
  const sources: SpriteRasters = {
    fighter: rasterize(fighter),
    shard: rasterize(shard),
    flux: rasterize(flux),
    prism: rasterize(prism),
  };
  return { ...toSprites(deriveArt(sources)), burst };
}
