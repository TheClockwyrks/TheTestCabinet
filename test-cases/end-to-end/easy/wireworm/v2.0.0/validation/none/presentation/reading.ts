// presentation/reading — how this group reads one drawn frame.
//
// Only the `presentation` group reads a frame this way, so these live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there, they fix a READING and an ARRANGEMENT alone — which pixels a
// colour is taken from, and where they are taken from — and never a threshold:
// every distance, tolerance and bound a check asserts is stated in that check,
// derived from the figure `specs/` fixes for it.
//
// THE COLOUR OF A THING IS THE COLOUR OF ITS LIT PART. specs/overview.md fixes no
// palette and no typeface — "The palette, the type, the glow, and every other
// aspect of the look are yours" — but it does fix one thing about the board:
// "The board is dark." Everything the game shows is therefore a lit element
// standing on a dark ground, and every seeded frame under `assets/` is a sparse
// mark on a transparent field (specs/assets.md), so most of the pixels of the
// tile a node stands on are the board showing through it. Averaging the whole
// tile would read mostly board whatever stands there, and would tell two states
// apart by however much their marks happened to differ in AREA. So the reading is
// the mean of the brightest {@link LIT_FRACTION} of a box's pixels: the mark
// itself, which is what a player's eye goes to and what specs/overview.md's
// legibility table is written about.
//
// The same reading is taken off bare board, where the brightest pixels are the
// board's own, so an element and the ground behind it are always compared like
// with like.
//
// WHY THE HARNESS'S OWN `sampleColor` IS NOT WHAT THESE POINTS USE. That reading
// is five points of a cluster averaged, which is the right reading for a check
// asking whether a tile CHANGED — board/tile-centres asks exactly that. It is the
// wrong reading for a check asking what colour a body IS, because four of its
// five points commonly land on the board showing through a sparse frame.
//
// EVERYTHING HERE CROSSES INTO THE PAGE, because under this engine the picture is
// on a canvas in a browser rather than on one this process holds.

import { STAGE_H, STAGE_W, TILE, tileCX, tileCY } from "../constants";
import { colorDistance, type Harness, type Rgb } from "../harness";

/* -------------------------------------------------------------------------- */
/* Boxes                                                                      */
/* -------------------------------------------------------------------------- */

/** A square of the stage, in logical units, named by its centre and half-extent. */
export interface Box {
  x: number;
  y: number;
  half: number;
}

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

/** The box a tile is read through: centred on the tile, inset from its edges. */
export function tileBox(c: number, r: number): Box {
  return { x: tileCX(c), y: tileCY(r), half: TILE_HALF };
}

/** The box a body reported at a stage position is read through. */
export function pointBox(x: number, y: number, half = TILE_HALF): Box {
  return { x, y, half };
}

/* -------------------------------------------------------------------------- */
/* Reading pixels                                                             */
/* -------------------------------------------------------------------------- */

/** Every device pixel of one box, row-major, with the box's device extent. */
export interface Patch {
  pixels: Rgb[];
  width: number;
  height: number;
  /** Where the patch's top-left device pixel sits, in device pixels. */
  left: number;
  top: number;
  /** Device pixels per logical unit, so a pixel index maps back to the stage. */
  scale: number;
}

/**
 * Every device pixel inside `box`, in one crossing into the page.
 *
 * The canvas is found the way the harness finds it — the largest `<canvas>` on
 * the page — and the box is clamped to the surface, so a box that reaches past
 * an edge reads what is there rather than throwing.
 */
export async function readBox(h: Harness, box: Box): Promise<Patch> {
  const view = h.viewport();
  const from = h.device(box.x - box.half, box.y - box.half);
  const to = h.device(box.x + box.half, box.y + box.half);
  const width = Math.max(1, to.x - from.x);
  const height = Math.max(1, to.y - from.y);
  const read = await h.page.evaluate(
    ([x, y, w, hgt]) => {
      const canvases = Array.from(document.querySelectorAll("canvas"));
      if (canvases.length === 0)
        throw new Error("wireworm: the page has no <canvas>");
      let canvas = canvases[0];
      for (const other of canvases) {
        if (other.width * other.height > canvas.width * canvas.height)
          canvas = other;
      }
      const ctx = canvas.getContext("2d");
      if (ctx === null)
        throw new Error("wireworm: the canvas has no 2D context");
      const left = Math.min(Math.max(x, 0), Math.max(canvas.width - 1, 0));
      const top = Math.min(Math.max(y, 0), Math.max(canvas.height - 1, 0));
      const cols = Math.max(1, Math.min(w, canvas.width - left));
      const rows = Math.max(1, Math.min(hgt, canvas.height - top));
      const { data } = ctx.getImageData(left, top, cols, rows);
      // Packed as one number a pixel: an unpacked triple is three times the
      // JSON, and a box read a hundred times over is the one thing in this
      // group that pays for its transport.
      const packed: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        packed.push(data[i] * 65536 + data[i + 1] * 256 + data[i + 2]);
      }
      return { packed, width: cols, height: rows, left, top };
    },
    [from.x, from.y, width, height] as const,
  );
  return {
    pixels: read.packed.map(unpack),
    width: read.width,
    height: read.height,
    left: read.left,
    top: read.top,
    scale: view.scale,
  };
}

/** One packed pixel, back as a colour. */
function unpack(value: number): Rgb {
  return {
    r: Math.floor(value / 65536) % 256,
    g: Math.floor(value / 256) % 256,
    b: value % 256,
  };
}

/** Where a patch's pixel sits on the stage, in logical units. */
export function patchPoint(
  patch: Patch,
  index: number,
): { x: number; y: number } {
  const column = index % patch.width;
  const row = (index - column) / patch.width;
  return {
    x: (patch.left + column) / patch.scale,
    y: (patch.top + row) / patch.scale,
  };
}

/* -------------------------------------------------------------------------- */
/* Reading a colour                                                           */
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

/** How bright a colour is, on the 0–255 scale (Rec. 601). */
export function brightness(colour: Rgb): number {
  return 0.299 * colour.r + 0.587 * colour.g + 0.114 * colour.b;
}

/** The mean of the brightest {@link LIT_FRACTION} of a patch's pixels. */
export function litOf(patch: Patch): Rgb {
  const sorted = [...patch.pixels].sort(
    (a, b) => brightness(b) - brightness(a),
  );
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

/**
 * The colour of whatever is lit inside `box`.
 *
 * On bare board the brightest pixels are the ground's own, so this reads the
 * ground; on a tile a node, a segment, a foe or the cursor stands on, it reads
 * that body's own mark.
 */
export async function litColor(h: Harness, box: Box): Promise<Rgb> {
  return litOf(await readBox(h, box));
}

/** The colour of whatever is lit on tile `(c, r)` (specs/board.md). */
export function litTile(h: Harness, c: number, r: number): Promise<Rgb> {
  return litColor(h, tileBox(c, r));
}

/* -------------------------------------------------------------------------- */
/* Scanning for something drawn                                               */
/* -------------------------------------------------------------------------- */

/** How far a scan found the board's colour departed from, and where. */
export interface Departure {
  distance: number;
  x: number;
  y: number;
}

/**
 * The pixel within `radius` logical units of `(x, y)` that sits furthest from
 * `ground`, and how far it sits.
 *
 * The reading for a point asking whether SOMETHING was drawn at a place the game
 * itself reports — a bolt at the centre the snapshot gives it, lightning along
 * the chord between two tile centres — without asking what shape or colour the
 * build drew it in. A disc rather than a square, so the radius means the same
 * thing in every direction.
 */
export async function furthestFrom(
  h: Harness,
  x: number,
  y: number,
  radius: number,
  ground: Rgb,
): Promise<Departure> {
  const patch = await readBox(h, {
    x: Math.min(Math.max(x, 0), STAGE_W),
    y: Math.min(Math.max(y, 0), STAGE_H),
    half: radius,
  });
  let found: Departure = { distance: -1, x, y };
  for (const [index, pixel] of patch.pixels.entries()) {
    const at = patchPoint(patch, index);
    if (Math.hypot(at.x - x, at.y - y) > radius) continue;
    const distance = colorDistance(pixel, ground);
    if (distance > found.distance) found = { distance, x: at.x, y: at.y };
  }
  return found;
}

/** A sampled colour, written the way a failure message reads it. */
export function rgb(colour: Rgb): string {
  return `rgb(${colour.r.toFixed(0)}, ${colour.g.toFixed(0)}, ${colour.b.toFixed(0)})`;
}
