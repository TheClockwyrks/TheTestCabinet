// presentation/reading — how this group reads one drawn frame.
//
// Only the `presentation` group reads a frame this way, so these live beside the
// checks that use them rather than in the shared harness next door. Like
// everything there, they fix a READING and an ARRANGEMENT alone — which pixels
// are taken, and where they are taken from — and never a threshold: every bound
// a check asserts is stated in that check, derived from the figure `specs/`
// fixes for it.
//
// NO COLOUR IS READ HERE. specs/overview.md fixes no palette and no typeface, so
// nothing in this group asks what colour a body is drawn in. A point either
// reads the image source handed to a draw, or reads one place of the board twice
// — with the thing there and with it removed through the debug API — and asks
// only whether the picture changed. What the change looks like is the reviewer's,
// from the captured still.
//
// EVERYTHING HERE CROSSES INTO THE PAGE, because under this engine the picture is
// on a canvas in a browser rather than on one this process holds.

import { STAGE_H, STAGE_W } from "../constants";
import { colorDistance, type Blit, type Harness, type Rgb } from "../harness";

/* -------------------------------------------------------------------------- */
/* Boxes                                                                      */
/* -------------------------------------------------------------------------- */

/** A square of the stage, in logical units, named by its centre and half-extent. */
export interface Box {
  x: number;
  y: number;
  half: number;
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
 * Every device pixel of the stage rectangle with corners `(x0, y0)` and
 * `(x1, y1)`, in one crossing into the page.
 *
 * The canvas is found the way the harness finds it — the largest `<canvas>` on
 * the page — and the rectangle is clamped to the surface, so one that reaches
 * past an edge reads what is there rather than throwing.
 */
export async function readRect(
  h: Harness,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Promise<Patch> {
  const view = h.viewport();
  const from = h.device(x0, y0);
  const to = h.device(x1, y1);
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

/** Every device pixel inside `box`. */
export function readBox(h: Harness, box: Box): Promise<Patch> {
  return readRect(
    h,
    box.x - box.half,
    box.y - box.half,
    box.x + box.half,
    box.y + box.half,
  );
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
/* Scanning for something drawn                                               */
/* -------------------------------------------------------------------------- */

/** How far a scan found a place departed from what it was, and where. */
export interface Departure {
  distance: number;
  x: number;
  y: number;
}

/**
 * The disc of `radius` logical units around `(x, y)`, read as a patch.
 *
 * The place a point asking whether SOMETHING was drawn looks at: a bolt at the
 * centre the snapshot gives it, lightning at a station along the chord between
 * two tile centres. The patch is square and {@link furthestChange} takes the
 * disc out of it, so the radius means the same thing in every direction.
 */
export function readDisc(
  h: Harness,
  x: number,
  y: number,
  radius: number,
): Promise<Patch> {
  return readBox(h, {
    x: Math.min(Math.max(x, 0), STAGE_W),
    y: Math.min(Math.max(y, 0), STAGE_H),
    half: radius,
  });
}

/**
 * The pixel within `radius` logical units of `(x, y)` that MOVED furthest
 * between two readings of the same place, and how far it moved.
 *
 * The reading for a point asking whether something was drawn where the game says
 * it is, without asking what shape or colour the build drew it in — and without
 * assuming a board colour, since specs/overview.md fixes none and a build is
 * free to rule, shade or texture its ground. What is compared is each pixel
 * against ITSELF on a reading of the same board with the thing gone, so a build
 * that etched a trace through that disc is compared against its own trace.
 */
export function furthestChange(
  before: Patch,
  after: Patch,
  x: number,
  y: number,
  radius: number,
): Departure {
  let found: Departure = { distance: -1, x, y };
  for (const [index, pixel] of after.pixels.entries()) {
    const was = before.pixels[index];
    if (was === undefined) continue;
    const at = patchPoint(after, index);
    if (Math.hypot(at.x - x, at.y - y) > radius) continue;
    const distance = colorDistance(pixel, was);
    if (distance > found.distance) found = { distance, x: at.x, y: at.y };
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* Attributing a draw to the body it was drawn for                            */
/* -------------------------------------------------------------------------- */

/**
 * Every bitmap the frame blitted whose destination box is centred within
 * `within` logical units of `at`.
 *
 * The harness's own {@link drawnFrom} answers the same question of one seeded
 * folder; this answers it of ALL of them, which is what a failure message needs
 * to say what the build drew there instead.
 */
export function blitsNear(
  blits: readonly Blit[],
  at: { x: number; y: number },
  within: number,
): Blit[] {
  return blits.filter(
    (blit) => Math.hypot(blit.x - at.x, blit.y - at.y) <= within,
  );
}

/**
 * What a run of blits drew, as a failure message names it: each one either the
 * seeded frames it is identical to, or the size of the bitmap it was instead.
 */
export function describeBlits(blits: readonly Blit[]): string {
  if (blits.length === 0) return "no bitmap was blitted there";
  return blits
    .map((blit) =>
      blit.matches.length === 0
        ? `a ${blit.source.width}x${blit.source.height} bitmap of the build's own`
        : blit.matches
            .map((frame) => `assets/${frame.sheet}/${frame.index}.png`)
            .join(" = "),
    )
    .join(", ");
}
