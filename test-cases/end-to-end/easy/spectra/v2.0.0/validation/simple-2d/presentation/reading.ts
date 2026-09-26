// presentation/reading — how this group reads what one frame painted.
//
// These live beside the checks that use them rather than in the shared harness
// next door, because this group is where reading a frame this way belongs and
// where nearly every caller is. `field/ship-lane` is the one caller outside it:
// it identifies the ship's blit by shape for the same reason every check here
// does, and borrowing the reading is what keeps the two from drifting apart. Like
// everything else in this group they fix a READING alone — which places of a region a thing
// painted, and what shape a build blitted — and never a threshold: every share,
// agreement and bound a check asserts is stated in that check, derived from the
// figure `specs/` fixes for it.
//
// WHAT IS READ OF A REGION IS PRESENCE, NEVER APPEARANCE. `specs/overview.md`
// fixes no palette — the colours, the type and the glow are the build's — so
// nothing here answers what a thing LOOKS like. The one question a region
// reading answers is whether the build DREW something in a place the
// specification says something is drawn.
//
// AND WHY THE CONTROL IS THE SAME SQUARE OF THE SAME FIELD. `specs/field.md`
// puts a starfield behind the play field and leaves a build free to place a
// banner, a hint or a watermark anywhere it likes, so a reading held against a
// fixed colour would read a build's own stars as an entity. Every region reading
// below is therefore taken TWICE at the same place — once with the thing on the
// field and once with it gone — and only the places that MOVED between the two
// are read as the thing. What is left cannot be the field, the starfield, or
// anything else the build drew there, because both readings carry it.
//
// WHAT IS COMPARED WHEN A CHECK ASKS WHETHER THE SEEDED ART WAS DRAWN IS THE
// ALPHA SILHOUETTE, NOT THE PIXELS. `specs/assets.md` asks for one silhouette in
// two band-states and leaves the build the route: it may composite the band's
// colour over the seeded PNG at draw time, or bake a per-band copy once at load
// and blit that. Under the second route the bitmap handed to `drawImage` is the
// build's own canvas and its COLOURS are the build's, but its SHAPE is still the
// seeded one — so the shape is what a sprite check reads, and the harness's own
// `identifySprite`, which holds a source's PIXELS against the seeded file, is
// not what this group uses. The agreement is a number rather than a verdict; the
// fraction a check will accept is that check's own figure.
//
// EVERYTHING HERE IS ARITHMETIC OVER READINGS THE HARNESS ALREADY TOOK. The
// regions come from its `readRegion`, the draws from its `drawFrame` and
// `drawnImages`, and the seeded files off the same `assets/` tree it serves the
// build from.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { fail } from "../assert";
import { SPRITES, SPRITE_SIZE } from "../constants";
import {
  colorDistance,
  distance,
  drawFrame,
  drawnImages,
  type Box,
  type DrawnImage,
  type Harness,
  type Region,
  type Rgb,
} from "../harness";

/** The name each seeded sprite is drawn for (`specs/assets.md`). */
export type SpriteName = keyof typeof SPRITES;

/** The four names, in the order `specs/assets.md` lists them. */
const SPRITE_NAMES = Object.keys(SPRITES) as SpriteName[];

/* -------------------------------------------------------------------------- */
/* The boxes a check reads through                                            */
/* -------------------------------------------------------------------------- */

/** The square of stage a body of footprint `size` occupies, centred on `(x, y)`. */
export function footprintOf(x: number, y: number, size: number): Box {
  return { x: x - size / 2, y: y - size / 2, w: size, h: size };
}

/** The box a body drawn `w` by `h` occupies, centred on `(x, y)`. */
export function boxOf(x: number, y: number, w: number, h: number): Box {
  return { x: x - w / 2, y: y - h / 2, w, h };
}

/* -------------------------------------------------------------------------- */
/* What counts as painted                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How far a place must move between the two readings to count as painted, as a
 * Euclidean RGB distance out of the `441` an RGB cube is across.
 *
 * THIS IS THE READING, NOT A THRESHOLD: it decides which places of a region
 * count as drawn on, and it is the whole of what a region check asserts. Two
 * readings of one place nothing was drawn on are identical, so anything above
 * zero would do to separate painted from unpainted; `12` is a little above the
 * rounding one composite can put on a pixel, so a faint glow a build lays around
 * a body counts as part of it and an untouched pixel never does.
 */
export const PAINT_MIN = 12;

/** Two readings of one square, or a failure naming the pair that disagreed. */
function sameLattice(a: Region, b: Region): number {
  if (a.width !== b.width || a.height !== b.height) {
    fail(
      `two readings of the same square (${a.width}x${a.height})`,
      `${b.width}x${b.height}`,
    );
  }
  return a.width * a.height;
}

/** The colour of the place at `pixel` of a region already read. */
function colorOf(region: Region, pixel: number): Rgb {
  const at = pixel * 4;
  return { r: region.data[at], g: region.data[at + 1], b: region.data[at + 2] };
}

/** Whether the place at `pixel` moved between the two readings. */
function movedAt(bare: Region, now: Region, pixel: number): boolean {
  return colorDistance(colorOf(bare, pixel), colorOf(now, pixel)) > PAINT_MIN;
}

/* -------------------------------------------------------------------------- */
/* What a thing painted                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many places of a region a thing painted: the places that moved between a
 * reading taken with the thing on the field and a reading of the same region
 * with the thing gone.
 *
 * The reading every region check in this group takes. A thing that painted
 * nothing reports `0`, which is the failure those checks name.
 */
export function paintedCount(bare: Region, now: Region): number {
  const total = sameLattice(bare, now);
  let count = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    if (movedAt(bare, now, pixel)) count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* What shape the build blitted                                               */
/* -------------------------------------------------------------------------- */

/**
 * A drawn source's alpha silhouette, normalized to a `SPRITE_SIZE` square.
 *
 * `255` where the source is opaque enough to read as drawn, `0` where it is not.
 * Normalized to one size so a build that bakes at another resolution, or blits
 * out of an atlas, is compared on the SHAPE it draws rather than on the number
 * of pixels it stored it in; sampled without smoothing, so pixel art stays crisp
 * and an edge does not soften into a half-alpha ramp that the threshold below
 * then reads differently on the two sides of the comparison.
 */
export type Silhouette = Uint8Array;

/** The alpha a pixel needs to count as part of the silhouette. */
const ALPHA_ON = 128;

/** Every place reported as unpainted: what a source that would not raster scores. */
const NO_SILHOUETTE: Silhouette = new Uint8Array(0);

/**
 * `source`'s alpha silhouette, cropped to the sub-rect the call named first.
 *
 * The crop is what makes the comparison hold for a build that composed an atlas
 * of its own and blits out of it with the nine-argument `drawImage`: what is
 * compared is then the sub-rect the draw named rather than the sheet behind it.
 */
function silhouetteOf(
  source: unknown,
  crop?: { x: number; y: number; width: number; height: number },
): Silhouette {
  const canvas = createCanvas(SPRITE_SIZE, SPRITE_SIZE);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  ctx.imageSmoothingEnabled = false;
  // The cast is the one this comparison needs: everything handed here is a
  // bitmap this canvas implementation can blit, and the decoders it comes from
  // do not share a nominal type.
  const bitmap = source as Parameters<SKRSContext2D["drawImage"]>[0];
  try {
    if (crop === undefined) {
      ctx.drawImage(bitmap, 0, 0, SPRITE_SIZE, SPRITE_SIZE);
    } else {
      ctx.drawImage(
        bitmap,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        SPRITE_SIZE,
        SPRITE_SIZE,
      );
    }
  } catch {
    return NO_SILHOUETTE;
  }
  const { data } = ctx.getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  const mask = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = data[i * 4 + 3] >= ALPHA_ON ? 255 : 0;
  }
  return mask;
}

/**
 * The fraction of positions, from `0` to `1`, at which two silhouettes agree.
 *
 * The measurement the five silhouette checks in this group state their own
 * figure against. Two masks of different lengths agree nowhere.
 */
export function silhouetteAgreement(a: Silhouette, b: Silhouette): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let same = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) same += 1;
  return same / a.length;
}

/** The directory this module sits in; the workspace is two levels above it. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Read once, because every silhouette check reads the same four files. */
let seeded: Promise<Readonly<Record<SpriteName, Silhouette>>> | null = null;

/** The four seeded PNGs' silhouettes, read off the workspace's own `assets/`. */
async function readSeeded(): Promise<Readonly<Record<SpriteName, Silhouette>>> {
  const masks = {} as Record<SpriteName, Silhouette>;
  for (const name of SPRITE_NAMES) {
    const bytes = readFileSync(join(WORKSPACE, "assets", SPRITES[name]));
    masks[name] = silhouetteOf(await loadImage(bytes));
  }
  return masks;
}

/**
 * The silhouette of each sprite `specs/assets.md` seeds, off the same `assets/`
 * tree the harness serves the build from — so a match is against exactly the art
 * the case seeded rather than against a copy of it.
 */
export function seededSilhouettes(): Promise<
  Readonly<Record<SpriteName, Silhouette>>
> {
  // A read that failed is NOT kept: a memoised rejection would answer every
  // later check with the first one's error, long after whatever caused it.
  seeded ??= readSeeded().catch((error: unknown) => {
    seeded = null;
    throw error;
  });
  return seeded;
}

/** One bitmap a frame blitted, with the shape it took. */
export interface Blit extends DrawnImage {
  /** The source's own alpha silhouette, for comparing two draws with each other. */
  silhouette: Silhouette;
  /** How closely that silhouette agrees with each seeded sprite's, `0` to `1`. */
  agreement: Readonly<Record<SpriteName, number>>;
  /** The source rasterized at all. A source that would not scores every sprite `0`. */
  captured: boolean;
}

/**
 * Run one frame and hand back every bitmap it blitted, each with its silhouette.
 *
 * The reading every silhouette check in this group opens with. The frame is the
 * harness's own {@link drawFrame} — the calls of ONE frame, not of the setup
 * before it — and each `drawImage` is placed through the harness's
 * {@link drawnImages}, so where a draw landed is the same mapping every other
 * presentation reading uses.
 */
export async function blitsOfFrame(h: Harness): Promise<Blit[]> {
  const calls = await drawFrame(h);
  const sprites = await seededSilhouettes();
  return drawnImages(h, calls).map((image) => {
    const silhouette = silhouetteOf(image.source, image.crop);
    const agreement = {} as Record<SpriteName, number>;
    for (const name of SPRITE_NAMES) {
      agreement[name] = silhouetteAgreement(sprites[name], silhouette);
    }
    return {
      ...image,
      silhouette,
      agreement,
      captured: silhouette.length > 0,
    };
  });
}

/** Every blit whose destination box is centred within `within` units of a point. */
export function blitsNear(
  blits: readonly Blit[],
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits
    .filter((blit) => distance(blit, at) <= within)
    .sort((a, b) => distance(a, at) - distance(b, at));
}

/**
 * The blit of a run that agrees best with one seeded sprite.
 *
 * Which draw a check is about, when a build is free to lay a glow, a shadow or a
 * halo of its own around a body and blit that too: the one that looks most like
 * the seeded art is the one the entity is claimed to be drawn from, and the
 * check states how closely it must agree.
 */
export function bestBlit(
  blits: readonly Blit[],
  sprite: SpriteName,
): Blit | undefined {
  let best: Blit | undefined;
  for (const blit of blits) {
    if (best === undefined || blit.agreement[sprite] > best.agreement[sprite]) {
      best = blit;
    }
  }
  return best;
}

/**
 * What a run of blits drew, as a failure message names it: each one's
 * destination box, the size of the source behind it, and how closely that source
 * agrees with each seeded sprite.
 */
export function describeBlits(blits: readonly Blit[]): string {
  if (blits.length === 0) return "no bitmap was blitted there";
  return blits
    .map((blit) => {
      const scores = SPRITE_NAMES.map(
        (name) => `${name} ${blit.agreement[name].toFixed(3)}`,
      ).join(", ");
      const held = blit.source as { width?: unknown; height?: unknown };
      const source =
        blit.captured &&
        typeof held?.width === "number" &&
        typeof held?.height === "number"
          ? `${held.width}x${held.height} source`
          : "a source the reading could not raster";
      return (
        `a ${blit.w.toFixed(1)}x${blit.h.toFixed(1)} box from a ${source} ` +
        `(${scores})`
      );
    })
    .join("; ");
}
