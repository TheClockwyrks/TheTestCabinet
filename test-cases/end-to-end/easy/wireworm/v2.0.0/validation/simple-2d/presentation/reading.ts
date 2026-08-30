// presentation/reading — how this group reads one drawn frame.
//
// Only the `presentation` group reads a frame this way, so these live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there, they fix a READING and an ARRANGEMENT alone — which pixels a
// colour is taken from, which draw is attributed to which body — and never a
// threshold: every distance, tolerance and bound a check asserts is stated in
// that check, derived from the figure specs/ fixes for it.
//
// THE COLOUR OF A THING IS THE COLOUR OF ITS LIT PART. specs/overview.md fixes no
// palette and no typeface — "The palette, the type, the glow, and every other
// aspect of the look are yours" — but it does fix one thing about the board:
// "The board is dark." Everything the game shows is therefore a lit element
// standing on a dark ground, and every seeded frame under `assets/` is a sparse
// mark on a transparent field, so most of the pixels of the tile a node stands on
// are the board showing through it. Averaging the whole tile would read mostly
// board whatever stands there, and would tell two states apart by however much
// their marks happened to differ in AREA. So the reading is the mean of the
// brightest {@link LIT_FRACTION} of the box's pixels: the mark itself, which is
// what a player's eye goes to and what specs/overview.md's legibility table is
// written about ("each state is visibly brighter or more energetic than the one
// below it").
//
// The same reading is taken off bare board, where every pixel is the same colour
// and the brightest of them is that colour, so an element and the ground behind
// it are always compared like with like.

import { TILE, tileCX, tileCY } from "../../src/constants";
import {
  identifySprite,
  type DrawnImage,
  type Harness,
  type Rgb,
  type SpriteMatch,
} from "../harness";

/* -------------------------------------------------------------------------- */
/* Sampling a colour                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The fraction of a box's pixels a colour is read from: the brightest of them.
 *
 * A twentieth of a `24 x 24` box is 29 pixels — about a `5 x 6` block, which is a
 * mark a player sees rather than a stray pixel, and small enough that a sparse
 * seeded frame is read by its own lit core instead of by the board around it.
 * This is the READING, not a tolerance: every bound a check asserts against what
 * comes out of it is stated in that check.
 */
export const LIT_FRACTION = 0.05;

/**
 * How far inside a tile's edges a tile-sized box is taken, in logical units.
 *
 * A build is free to rule its board — the look is its own — and any such rule
 * runs along the tile boundaries, so a box that reached the edges would read the
 * ruling rather than what stands on the tile. Four units of margin on a `TILE`
 * (`32`) of side leaves a `24 x 24` box centred on the tile, which still covers
 * the middle three quarters of a `SPRITE_SIZE` (`32`) frame drawn on it.
 */
export const TILE_INSET = 4;

/** The half-extent of the box {@link litTile} reads a tile through. */
export const TILE_HALF = TILE / 2 - TILE_INSET;

/** A square of the stage, in logical units, named by its centre and half-extent. */
export interface Box {
  x: number;
  y: number;
  half: number;
}

/** The box a tile is read through: centred on the tile, inset from its edges. */
export function tileBox(c: number, r: number): Box {
  return { x: tileCX(c), y: tileCY(r), half: TILE_HALF };
}

/** Every device pixel inside `box`, as `[r, g, b]` triples, in one read. */
function readBox(h: Harness, box: Box): Rgb[] {
  const from = h.device(box.x - box.half, box.y - box.half);
  const to = h.device(box.x + box.half, box.y + box.half);
  const width = Math.max(1, to.x - from.x);
  const height = Math.max(1, to.y - from.y);
  const { data } = h.ctx.getImageData(from.x, from.y, width, height);
  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += 4) {
    pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return pixels;
}

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function luminance(color: Rgb): number {
  return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

/**
 * The colour of whatever is lit inside `box`: the mean of the brightest
 * {@link LIT_FRACTION} of its pixels.
 *
 * On bare board every pixel is the ground, so this reads the ground; on a tile a
 * node, a segment, a foe or the cursor stands on, it reads that body's own mark.
 */
export function litColor(h: Harness, box: Box): Rgb {
  const pixels = readBox(h, box);
  const sorted = [...pixels].sort((a, b) => luminance(b) - luminance(a));
  const taken = Math.max(1, Math.round(sorted.length * LIT_FRACTION));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < taken; i += 1) {
    r += sorted[i].r;
    g += sorted[i].g;
    b += sorted[i].b;
  }
  return { r: r / taken, g: g / taken, b: b / taken };
}

/** The colour of whatever is lit on tile `(c, r)` (specs/board.md). */
export function litTile(h: Harness, c: number, r: number): Rgb {
  return litColor(h, tileBox(c, r));
}

/** The mean colour of every pixel in `box`: the ground a scan is held against. */
export function meanColor(h: Harness, box: Box): Rgb {
  const pixels = readBox(h, box);
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of pixels) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  return { r: r / pixels.length, g: g / pixels.length, b: b / pixels.length };
}

/** The colour of one device pixel, as the scans read it. */
export function pixelColor(h: Harness, x: number, y: number): Rgb {
  const [r, g, b] = h.pixel(x, y);
  return { r, g, b };
}

/* -------------------------------------------------------------------------- */
/* Attributing a draw to the body it was drawn for                            */
/* -------------------------------------------------------------------------- */

/**
 * Every image the frame drew whose destination box is centred within `radius` of
 * `(x, y)`.
 *
 * How a draw is named by the body it belongs to: the checks below pose every body
 * on a tile centre or read its reported centre back, so the draw and the body
 * coincide and the caller's radius is the whole of the slack.
 */
export function drawnAt(
  images: readonly DrawnImage[],
  x: number,
  y: number,
  radius: number,
): DrawnImage[] {
  return images.filter(
    (image) => Math.hypot(image.x - x, image.y - y) <= radius,
  );
}

/**
 * A seeded-frame identifier that rasterizes each distinct source once.
 *
 * A build hands the context the same `ImageBitmap` on every frame it draws that
 * frame on, so a check that reads a second of animation asks about the same
 * handful of objects a hundred times over. The identification itself is the
 * shared harness's — the source's own pixels held against the seeded PNGs — and
 * this only remembers what it answered.
 */
export function spriteReader(): (
  source: unknown,
) => Promise<SpriteMatch | null> {
  const seen = new Map<unknown, SpriteMatch | null>();
  return async (source: unknown): Promise<SpriteMatch | null> => {
    if (seen.has(source)) return seen.get(source) ?? null;
    const match = await identifySprite(source);
    seen.set(source, match);
    return match;
  };
}

/** Every seeded frame the draws near `(x, y)` were made from, in draw order. */
export async function framesDrawnAt(
  read: (source: unknown) => Promise<SpriteMatch | null>,
  images: readonly DrawnImage[],
  x: number,
  y: number,
  radius: number,
): Promise<SpriteMatch[]> {
  const near = drawnAt(images, x, y, radius);
  const matches = await Promise.all(near.map((image) => read(image.source)));
  return matches.filter((match): match is SpriteMatch => match !== null);
}

/** A seeded frame as a failure message names it: `assets/worm/2.png`. */
export function frameName(match: SpriteMatch): string {
  return `assets/${match.folder}/${match.index}.png`;
}
