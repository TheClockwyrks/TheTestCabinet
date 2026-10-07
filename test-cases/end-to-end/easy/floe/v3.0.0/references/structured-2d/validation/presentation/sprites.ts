// presentation — which piece of the seeded art a frame's draws were handed.
// PRIVATE to `presentation/`.
//
// Eleven points in this group assert that an element is drawn FROM the art this
// case ships (specs/assets.md: seven folders under `assets/`, and "the build
// renders each of those from its folder"). A build that draws a convincing shape
// in code satisfies every other point in this project and misses those eleven,
// which is the whole reason they exist.
//
// SO THE READING IS THE IMAGE SOURCE, NOT THE PIXELS ON THE STAGE. Every
// `drawImage` of one frame is taken with the bitmap it was handed, that bitmap is
// rasterized, and its pixels are held against the seeded PNGs the harness reads
// off the workspace's own `assets/` tree. A source that IS a seeded frame matches
// it; a canvas the build painted, a sheet of its own or a recoloured copy does
// not. A build is free to tint or scale what it blits, so a stage sample would
// grade the tint rather than the art.
//
// A REGION RATHER THAN A FRAME, because two of the things drawn are sub-rects.
// specs/assets.md makes the three-tile raft the LEFT `96 x 32` of
// `assets/raft/0.png` and the four-tile raft the whole of `assets/raft/1.png`, so
// the seeded side carries the whole frames AND those two named regions. A draw
// that named a source rectangle is compared against the region it cropped to, and
// a build that cropped the same pixels into a bitmap of its own before drawing is
// read the same way — what specs/assets.md fixes is which pixels are drawn, not
// which call form put them there.
//
// WHY THIS IS NOT THE HARNESS'S `drawnImages`. That reader places a blit's
// destination in stage units, which is exactly what is wanted, and reports the
// bitmap's own size — but a `drawImage` that named a source rectangle drew only
// PART of that bitmap, and the rectangle is the one thing the two raft points
// turn on. So the walk below is the harness's, widened by the source rectangle
// the call carried, and everything else about it — the transform-mapped
// destination centre, the reflected-determinant reading of `mirrored` — is the
// same reading taken the same way. Both start from the harness's `imageCalls`,
// which is the one place a frame's operations are replayed for the transform in
// force at each blit, so the two cannot disagree about where a sprite landed.
//
// Local to this group rather than on the shared harness: reading the BITMAP a
// draw was handed is the presentation group's own business, and every other group
// that poses a body or a lane reads positions and covering instead.

import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { SPRITE_TILE, TILE, tileTop } from "../constants";
import {
  imageCalls,
  seededFrames,
  type DrawCall,
  type Facing,
  type FloeKind,
  type Harness,
  type ItemKind,
  type Matrix,
  type SeededFrame,
  type SpriteFolder,
  type VehicleKind,
} from "../harness";
import { renderFrame } from "./frame";

/* -------------------------------------------------------------------------- */
/* The frame tables specs/assets.md fixes                                     */
/* -------------------------------------------------------------------------- */
//
// Facts about the SUPPLIED ART rather than figures over the simulation, which is
// why `constants.ts` does not carry them and this module does: each is read
// straight off the table in specs/assets.md, and the points that use them cite
// that table.

/** `assets/crosser/`: a crouch-and-leap pair per facing (specs/assets.md). */
export const CROSSER_FRAMES_BY_FACING: Readonly<
  Record<Facing, readonly [number, number]>
> = {
  down: [0, 1],
  up: [2, 3],
  left: [4, 5],
  right: [6, 7],
};

/** `assets/bear/` frames `0`–`7`: the four-facing run (specs/assets.md). */
export const BEAR_RUN_FRAMES: Readonly<
  Record<Facing, readonly [number, number]>
> = {
  down: [0, 1],
  up: [2, 3],
  left: [4, 5],
  right: [6, 7],
};

/** `assets/bear/` frames `8`–`15`: the four-facing swim (specs/assets.md). */
export const BEAR_SWIM_FRAMES: Readonly<
  Record<Facing, readonly [number, number]>
> = {
  down: [8, 9],
  up: [10, 11],
  left: [12, 13],
  right: [14, 15],
};

/** `assets/bear/` frames `16`–`17`: the lunge, any facing (specs/assets.md). */
export const BEAR_LUNGE_FRAMES: readonly number[] = [16, 17];

/** The folder specs/assets.md draws each lane-item kind from. */
export const FOLDER_OF_KIND: Readonly<Record<ItemKind, SpriteFolder>> = {
  plow: "plow",
  dogsled: "dogsled",
  car: "car",
  pan: "pan",
  raft3: "raft",
  raft4: "raft",
};

/** Whether a lane-item kind rides the ice band rather than the water band. */
export function isVehicleKind(kind: ItemKind): kind is VehicleKind {
  return kind === "plow" || kind === "dogsled" || kind === "car";
}

/** The floe kinds, for a caller that has one of each in hand. */
export function isFloeKind(kind: ItemKind): kind is FloeKind {
  return !isVehicleKind(kind);
}

/* -------------------------------------------------------------------------- */
/* The seeded regions                                                         */
/* -------------------------------------------------------------------------- */

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

/**
 * How far a drawn source's pixels may sit from a seeded region's, as a mean
 * absolute difference over premultiplied RGBA channels, out of `255`.
 *
 * The requirement is IDENTITY — the source IS the seeded art — so this is not a
 * likeness tolerance. It is room for the one lossy step in reading a bitmap back
 * out of a canvas: a partially transparent pixel is premultiplied on the way in
 * and un-premultiplied on the way out, so it can shift by a unit. Comparing on
 * premultiplied channels removes even that, and a different frame of the SAME
 * folder measures several times this.
 */
const SPRITE_MATCH_MAX = 1;

/** A rectangle of a source, in the source's own pixel units. */
interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The left `96 x 32` of `assets/raft/0.png` (specs/assets.md). */
const RAFT3_RECT: SourceRect = {
  sx: 0,
  sy: 0,
  sw: 3 * SPRITE_TILE,
  sh: SPRITE_TILE,
};

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
 * `raft4` is `raft` frame `1` whole under its own name — so a check can say which
 * of the two rafts a draw was for, and a build that squeezed the whole sheet into
 * the three-tile raft's span is reported as having drawn the FULL frame rather
 * than the region.
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

/* -------------------------------------------------------------------------- */
/* Reading a frame's blits                                                    */
/* -------------------------------------------------------------------------- */

/** One `drawImage` of a frame, placed in stage units and named against the art. */
export interface Sprite {
  /** The destination rectangle's centre, in stage units. */
  x: number;
  y: number;
  /** The destination rectangle's size, in stage units, always positive. */
  w: number;
  h: number;
  /**
   * Whether the transform at the call flipped the drawing, which is how a
   * vehicle — whose art faces right — is drawn facing the way a leftward lane
   * runs (specs/assets.md).
   */
  mirrored: boolean;
  /** Every seeded region the drawn source is, empty where it is none of them. */
  matches: SeededRegion[];
}

/** A source's own pixel size, where it reports one. */
function naturalSize(
  source: unknown,
): { width: number; height: number } | null {
  const held = source as { width?: unknown; height?: unknown } | null;
  if (typeof held?.width !== "number" || typeof held.height !== "number") {
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
    const alpha = data[i + 3];
    pixels[i] = (data[i] * alpha) / 255;
    pixels[i + 1] = (data[i + 1] * alpha) / 255;
    pixels[i + 2] = (data[i + 2] * alpha) / 255;
    pixels[i + 3] = alpha;
  }
  return { width, height, pixels };
}

/** The mean absolute difference between two equal-length channel runs. */
function meanDifference(a: Float64Array, b: Float64Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs(a[i] - b[i]);
  return total / a.length;
}

/** Every seeded region a drawn source is, within the match tolerance above. */
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

/** The source rectangle a `drawImage` named, or `null` for the whole bitmap. */
function sourceRectOf(numbers: readonly number[]): SourceRect | null {
  if (numbers.length < 8) return null;
  const [sx, sy, sw, sh] = numbers.slice(0, 4);
  if (![sx, sy, sw, sh].every(Number.isFinite)) return null;
  return { sx, sy, sw, sh };
}

/** Where a blit's destination rectangle landed, in stage units. */
function placeOf(
  m: Matrix,
  view: { offsetX: number; offsetY: number; scale: number },
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): Pick<Sprite, "x" | "y" | "w" | "h" | "mirrored"> {
  // The destination rectangle's centre, through the transform the call was made
  // under and then back through the engine's fit to stage units. The transform
  // is the canvas's own `[a, b, c, d, e, f]` tuple, which is how the harness
  // carries it.
  const localX = dx + dw / 2;
  const localY = dy + dh / 2;
  const deviceX = m[0] * localX + m[2] * localY + m[4];
  const deviceY = m[1] * localX + m[3] * localY + m[5];
  return {
    x: (deviceX - view.offsetX) / view.scale,
    y: (deviceY - view.offsetY) / view.scale,
    w: (Math.abs(dw) * Math.hypot(m[0], m[1])) / view.scale,
    h: (Math.abs(dh) * Math.hypot(m[2], m[3])) / view.scale,
    // A negative determinant is a reflection, which is the only way an axis is
    // flipped: a rotation alone leaves it positive.
    mirrored: m[0] * m[3] - m[1] * m[2] < 0,
  };
}

/** Every `drawImage` of `calls`, placed in stage units and named against the art. */
export async function spritesOf(
  h: Harness,
  calls: readonly DrawCall[],
): Promise<Sprite[]> {
  const table = await seededRegions();
  const view = h.engine.viewport();
  const cache = new Map<string, ReturnType<typeof channelsOf>>();
  const keys = new WeakMap<object, number>();
  let nextKey = 0;
  const sprites: Sprite[] = [];

  for (const blit of imageCalls(calls)) {
    const source = blit.args[0];
    if (naturalSize(source) === null) continue;

    const numbers = blit.args
      .slice(1)
      .map((value) => (typeof value === "number" ? value : NaN));
    const rect = sourceRectOf(numbers);
    let dx: number;
    let dy: number;
    let dw: number;
    let dh: number;
    if (numbers.length >= 8) {
      [dx, dy, dw, dh] = numbers.slice(4, 8);
    } else if (numbers.length >= 4) {
      [dx, dy, dw, dh] = numbers.slice(0, 4);
    } else if (numbers.length >= 2) {
      const size = naturalSize(source);
      if (size === null) continue;
      [dx, dy] = numbers.slice(0, 2);
      dw = size.width;
      dh = size.height;
    } else {
      continue;
    }
    if (![dx, dy, dw, dh].every(Number.isFinite)) continue;

    // The bitmap is cached by identity and crop: a frame drawn on every tick of
    // a scenario is rasterized once.
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
    const key = `${id}|${
      rect === null ? "*" : `${rect.sx},${rect.sy},${rect.sw},${rect.sh}`
    }`;
    let drawn = cache.get(key);
    if (drawn === undefined) {
      drawn = channelsOf(source, rect);
      cache.set(key, drawn);
    }

    sprites.push({
      ...placeOf(blit.transform, view, dx, dy, dw, dh),
      matches: drawn === null ? [] : matchesOf(table, drawn),
    });
  }
  return sprites;
}

/** Run one frame and resolve every `drawImage` it made against the seeded art. */
export async function spritesOfFrame(h: Harness): Promise<Sprite[]> {
  await renderFrame(h);
  return spritesOf(h, h.calls);
}

/* -------------------------------------------------------------------------- */
/* Asking a frame's blits a question                                          */
/* -------------------------------------------------------------------------- */

/**
 * Every draw whose source is a frame of `folder` and whose destination box is
 * centred within `within` stage units of `at`.
 *
 * `within` is the caller's, because how close a sprite has to sit to the body it
 * draws is the check's requirement rather than this helper's: specs/assets.md
 * says a 32 x 32 frame is drawn centred on its subject's own centre, and the
 * check states how much of a tile it will allow.
 */
export function drawnFrom(
  sprites: readonly Sprite[],
  folder: SpriteFolder,
  at: { x: number; y: number },
  within: number,
): Sprite[] {
  return sprites.filter(
    (sprite) =>
      Math.hypot(sprite.x - at.x, sprite.y - at.y) <= within &&
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
      Math.hypot(sprite.x - at.x, sprite.y - at.y) <= within &&
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

/**
 * The centre of the box a lane item's art covers: its own `x`, its row's top
 * edge, and `TILE` units of width per tile it spans (specs/assets.md).
 */
export function laneArtCentre(item: { x: number; row: number; len: number }): {
  x: number;
  y: number;
} {
  return {
    x: item.x + (TILE * item.len) / 2,
    y: tileTop(item.row) + TILE / 2,
  };
}
