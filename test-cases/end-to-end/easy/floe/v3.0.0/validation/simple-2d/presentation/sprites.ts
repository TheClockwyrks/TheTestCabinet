// presentation — which piece of the seeded art a frame's draws were handed.
//
// Eleven points in this group assert that an element is drawn FROM the art this
// case ships (specs/assets.md: seven folders under `assets/`, and "the build
// renders each of those from its folder"). A build that draws a convincing
// shape in code satisfies every other point in this project and misses those
// eleven, which is the whole reason they exist.
//
// SO THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` of one frame is taken with the bitmap it was handed, that bitmap
// is rasterized, and its pixels are held against the seeded PNGs the harness
// reads off the workspace's own `assets/` tree. A source that IS a seeded frame
// matches it; a canvas the build painted, a sheet of its own or a recoloured
// copy does not. A build is free to tint or scale what it blits, so a stage
// sample would grade the tint rather than the art.
//
// A REGION RATHER THAN A FRAME, because two of the things drawn are sub-rects.
// specs/assets.md makes the three-tile raft the LEFT `96 x 32` of
// `assets/raft/0.png` and the four-tile raft the whole of `assets/raft/1.png`,
// so the seeded side carries the whole frames AND those two named regions. A
// draw that named a source rectangle is compared against the region it cropped
// to, and a build that cropped the same pixels into a bitmap of its own before
// drawing is read the same way — what specs/assets.md fixes is which pixels are
// drawn, not which call form put them there.
//
// Local to this group rather than on the shared harness: reading the BITMAP a
// draw was handed is the presentation group's own business, and every other
// group that poses a body or a lane reads positions and covering instead.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  drawFrame,
  drawnImages,
  seededFrames,
  SPRITE_MATCH_MAX,
  type DrawCall,
  type DrawnImage,
  type Harness,
  type SeededFrame,
  type SourceRect,
  type SpriteFolder,
} from "../harness";

/**
 * Which part of a seeded frame a region is.
 *
 * `"full"` for the whole of it; the two names specs/assets.md gives the
 * sub-rects it cuts out of `assets/raft/` for the three- and four-tile rafts.
 */
export type Region = "full" | "raft3" | "raft4";

/** One seeded frame, or a named region of one, as the comparison reads it. */
export interface SeededRegion {
  folder: SpriteFolder;
  index: number;
  region: Region;
  width: number;
  height: number;
  /** Premultiplied RGBA, four channels per pixel, as the harness reads them. */
  pixels: Float64Array;
}

/** One `drawImage` of a frame, and the seeded regions its source turned out to be. */
export interface Sprite {
  /** The draw, placed in logical units by the harness. */
  image: DrawnImage;
  /** Every seeded region its source is, empty where it is none of them. */
  matches: SeededRegion[];
}

/** The left `96 x 32` of `assets/raft/0.png` (specs/assets.md). */
const RAFT3_RECT: SourceRect = { sx: 0, sy: 0, sw: 96, sh: 32 };

/** A rectangle of a seeded frame's channels, in the frame's own pixel units. */
function cropOf(frame: SeededFrame, rect: SourceRect): Float64Array {
  const out = new Float64Array(rect.sw * rect.sh * 4);
  for (let y = 0; y < rect.sh; y += 1) {
    const from = ((rect.sy + y) * frame.width + rect.sx) * 4;
    out.set(frame.pixels.subarray(from, from + rect.sw * 4), y * rect.sw * 4);
  }
  return out;
}

/** Read once, because every sprite point in this group holds the same table. */
let regions: Promise<SeededRegion[]> | null = null;

/**
 * Every seeded frame whole, plus the two regions specs/assets.md names.
 *
 * The whole frames come from the harness, which reads them off the tree the
 * build was handed; the `raft3` region is cut from `raft` frame `0` here, and
 * `raft4` is `raft` frame `1` whole under its own name — so a check can say
 * which of the two rafts a draw was for, and a build that squeezed the whole
 * sheet into the three-tile raft's span is reported as having drawn the FULL
 * frame rather than the region.
 */
export function seededRegions(): Promise<SeededRegion[]> {
  // A read that failed is not kept: a memoised rejection would answer every
  // later check with the first one's error.
  regions ??= readSeededRegions().catch((error: unknown) => {
    regions = null;
    throw error;
  });
  return regions;
}

async function readSeededRegions(): Promise<SeededRegion[]> {
  const frames = await seededFrames();
  const table: SeededRegion[] = frames.map((frame) => ({
    folder: frame.folder,
    index: frame.index,
    region: "full" as const,
    width: frame.width,
    height: frame.height,
    pixels: frame.pixels,
  }));
  const raft = (index: number): SeededFrame | undefined =>
    frames.find((frame) => frame.folder === "raft" && frame.index === index);
  const raft0 = raft(0);
  if (raft0 !== undefined) {
    table.push({
      folder: "raft",
      index: 0,
      region: "raft3",
      width: RAFT3_RECT.sw,
      height: RAFT3_RECT.sh,
      pixels: cropOf(raft0, RAFT3_RECT),
    });
  }
  const raft1 = raft(1);
  if (raft1 !== undefined) {
    table.push({
      folder: "raft",
      index: 1,
      region: "raft4",
      width: raft1.width,
      height: raft1.height,
      pixels: raft1.pixels,
    });
  }
  return table;
}

/** A source's own pixel size, where it reports one. */
function naturalSize(
  source: unknown,
): { width: number; height: number } | null {
  const held = source as { width?: unknown; height?: unknown };
  if (typeof held?.width !== "number" || typeof held?.height !== "number") {
    return null;
  }
  return { width: held.width, height: held.height };
}

/**
 * A drawn source's premultiplied RGBA channels, cropped to the source rectangle
 * the call named.
 *
 * Premultiplied on the same convention the harness reads the seeded PNGs on, so
 * the one lossy step in getting a bitmap back out of a canvas cannot separate a
 * frame from itself.
 */
function channelsOf(
  source: unknown,
  rect: SourceRect | null,
): { width: number; height: number; pixels: Float64Array } | null {
  const size = naturalSize(source);
  if (size === null || size.width <= 0 || size.height <= 0) return null;
  const width = rect === null ? size.width : Math.round(rect.sw);
  const height = rect === null ? size.height : Math.round(rect.sh);
  if (width <= 0 || height <= 0) return null;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  try {
    if (rect === null) {
      ctx.drawImage(
        source as Parameters<SKRSContext2D["drawImage"]>[0],
        0,
        0,
        width,
        height,
      );
    } else {
      ctx.drawImage(
        source as Parameters<SKRSContext2D["drawImage"]>[0],
        rect.sx,
        rect.sy,
        rect.sw,
        rect.sh,
        0,
        0,
        width,
        height,
      );
    }
  } catch {
    return null;
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  const pixels = new Float64Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    pixels[i] = data[i] * alpha;
    pixels[i + 1] = data[i + 1] * alpha;
    pixels[i + 2] = data[i + 2] * alpha;
    pixels[i + 3] = data[i + 3];
  }
  return { width, height, pixels };
}

/** The mean absolute difference between two equal-length channel runs. */
function meanDifference(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** Every seeded region a drawn source is, within the harness's match tolerance. */
function matchesOf(
  table: readonly SeededRegion[],
  drawn: { width: number; height: number; pixels: Float64Array },
): SeededRegion[] {
  return table.filter(
    (entry) =>
      entry.width === drawn.width &&
      entry.height === drawn.height &&
      meanDifference(entry.pixels, drawn.pixels) <= SPRITE_MATCH_MAX,
  );
}

/** Every `drawImage` of `calls`, each resolved against the seeded art. */
export async function spritesOf(
  h: Harness,
  calls: readonly DrawCall[],
): Promise<Sprite[]> {
  const table = await seededRegions();
  const cache = new Map<string, ReturnType<typeof channelsOf>>();
  const sprites: Sprite[] = [];
  let nextKey = 0;
  const keys = new WeakMap<object, number>();
  for (const image of drawnImages(h, calls)) {
    const source = image.source;
    let id = "";
    if (typeof source === "object" && source !== null) {
      let held = keys.get(source);
      if (held === undefined) {
        held = nextKey;
        nextKey += 1;
        keys.set(source, held);
      }
      id = String(held);
    }
    const rect = image.sourceRect;
    const key = `${id}|${
      rect === null ? "*" : `${rect.sx},${rect.sy},${rect.sw},${rect.sh}`
    }`;
    let drawn = cache.get(key);
    if (drawn === undefined) {
      drawn = channelsOf(source, rect);
      cache.set(key, drawn);
    }
    sprites.push({
      image,
      matches: drawn === null ? [] : matchesOf(table, drawn),
    });
  }
  return sprites;
}

/** Run one frame and resolve every `drawImage` it made against the seeded art. */
export async function spritesOfFrame(h: Harness): Promise<Sprite[]> {
  return spritesOf(h, await drawFrame(h));
}

/**
 * Every draw whose source is a frame of `folder` and whose destination box is
 * centred within `within` logical units of `at`.
 *
 * `within` is the caller's, because how close a sprite has to sit to the body
 * it draws is the check's requirement rather than this helper's:
 * specs/assets.md says a 32 x 32 frame is drawn centred on its subject's own
 * centre, and the check states how much of a tile it will allow.
 */
export function drawnFrom(
  sprites: readonly Sprite[],
  folder: SpriteFolder,
  at: { x: number; y: number },
  within: number,
): Sprite[] {
  return sprites.filter(
    (sprite) =>
      Math.hypot(sprite.image.x - at.x, sprite.image.y - at.y) <= within &&
      sprite.matches.some((entry) => entry.folder === folder),
  );
}

/**
 * Every draw whose source is exactly the named REGION of `folder`, near `at`.
 *
 * The narrower sibling of {@link drawnFrom}, for the two draws specs/assets.md
 * cuts out of one frame.
 */
export function drawnRegion(
  sprites: readonly Sprite[],
  folder: SpriteFolder,
  region: Region,
  at: { x: number; y: number },
  within: number,
): Sprite[] {
  return sprites.filter(
    (sprite) =>
      Math.hypot(sprite.image.x - at.x, sprite.image.y - at.y) <= within &&
      sprite.matches.some(
        (entry) => entry.folder === folder && entry.region === region,
      ),
  );
}

/** The frame indices of `folder` those draws used, in the order they were drawn. */
export function frameIndexes(
  sprites: readonly Sprite[],
  folder: SpriteFolder,
): number[] {
  return sprites.flatMap((sprite) =>
    sprite.matches
      .filter((entry) => entry.folder === folder)
      .map((entry) => entry.index),
  );
}

/** What the frame drew from `folder` anywhere, named for a failure message. */
export function describeDrawsFrom(
  sprites: readonly Sprite[],
  folder: SpriteFolder,
): string {
  const drawn = sprites.flatMap((sprite) =>
    sprite.matches
      .filter((entry) => entry.folder === folder)
      .map((entry) => `frame ${entry.index} region ${entry.region}`),
  );
  return drawn.length === 0
    ? `no seeded ${folder} art at all`
    : [...new Set(drawn)].join(", ");
}
