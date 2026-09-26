// screens — how the three checks about a MENU'S LOOK read what the build drew.
// PRIVATE to `screens/`.
//
// `specs/ui.md` fixes each menu's copy and the ORDER of its entries, and fixes that
// "the highlighted entry is drawn distinctly from the others, so a player always
// sees which entry confirming would take". It fixes nothing else: no palette, no
// typeface, no layout, no marker. So nothing here compares the canvas against a
// value of its own, and nothing here demands a particular distinction — a build
// that recolours the entry, that draws it larger, that puts a caret beside it or
// that boxes it is doing what the specification asked, and each of them moves the
// same reading.
//
// AN ENTRY IS FOUND BY ITS OWN COPY, NOT BY ITS PLACE. {@link entryDraw} looks for
// the run of text the entry's word appears in, mapped through whatever transform the
// build drew it under, so a menu drawn under a translate is read where it lands.
// Matching is by substring because a build commonly draws a selection marker or
// padding inside the same run ("> PLAY"); an entry whose copy is a substring of
// another entry's (`PLAY` inside `HOW TO PLAY`) is separated by excluding the runs
// that hold the longer one, which is why every caller hands the whole menu in.
//
// AND THE HIGHLIGHT IS READ AS A CHANGE ON THE ENTRY ITSELF. There is no colour to
// look for, so `screens/title-menu-highlight` reads the same band of canvas twice —
// once with the highlight on that entry and once with it on the other — and asks
// whether the build drew the entry differently. The band is the entry's own glyph
// span with room either side for a marker, and it is measured ONCE, from the frame
// the first reading was taken on, so both readings are of the same piece of canvas.

import { fail } from "../assert";
import { FIELD_H, FIELD_W } from "../constants";
import {
  colorDistance,
  drawnTextRuns,
  textDraws,
  type DrawCall,
  type Harness,
  type Rgb,
  type TextDraw,
} from "../harness";

/**
 * Room left either side of an entry's glyphs, in logical units, when its band is
 * measured.
 *
 * `specs/ui.md` lets a build show which entry is highlighted however it likes, and a
 * marker drawn BESIDE the entry is one of the commonest ways: the band therefore
 * reaches past the run's own glyphs so such a build is read as having drawn the
 * entry distinctly. Thirty-six units is a little under a menu entry's line height at
 * the logical field size, which is about as far from a word as a mark can sit and
 * still read as that word's.
 */
const MARKER_MARGIN = 36;

/**
 * Half the height of an entry's band, in logical units, before it is clamped.
 *
 * Text a player reads at `1280 x 720` runs tens of units tall, so a band reaching 24
 * units either side of the run's anchor covers the body of the glyphs whichever
 * baseline the build set. It is clamped to half the gap to the neighbouring entry so
 * one entry's band can never see the other's, which is what lets the check say that
 * the difference MOVED rather than merely that something on the screen changed.
 */
const BAND_HALF_HEIGHT = 24;

/** Samples across a band, and down it: 615 readings of one entry. */
const BAND_COLUMNS = 41;
const BAND_ROWS = 15;

/** How many readings one band is. */
export const BAND_SAMPLES = BAND_COLUMNS * BAND_ROWS;

/**
 * The sensing floor on a change: how far a reading must move between two frames
 * before the move can be called a redrawing, of the 441 an RGB distance can span.
 *
 * Eight. Below that a sampling cannot tell a redrawing from the rounding of an
 * 8-bit channel and the host's own anti-aliasing; above it nothing is decided
 * about how strongly the two readings differ. Anything the build drew differently
 * clears it, however faintly it drew it.
 */
export const CHANGE_DISTANCE = 8;

/** One entry's band: where it is, in logical field units. */
export interface Band {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The run of text `entry` was drawn in, of a menu whose entries are `all`.
 *
 * Fails when the entry was not drawn at all, which is the precondition a look check
 * cannot proceed without.
 *
 * THE LOGICAL RUNS FIRST, THEN THE CALLS. A build that letter-spaces its menu
 * draws one glyph per `fillText` — the only portable way to letter-space canvas
 * text — and `specs/ui.md` fixes the words while leaving their spacing to the
 * build, so read a call at a time such a menu shows `P`, `L`, `A`, `Y` and no
 * entry. The package's `drawnTextRuns` coalesces the glyphs back into the entry
 * they spell, placed as one extent, which is exactly the span a band wants (this
 * harness asks for `measureText`, so the runs are measured). The calls follow,
 * so a run the merge glued onto a neighbour still reads as the call that drew it;
 * a run drawn whole appears in both and the first, the run, is the one kept.
 */
export function entryDraw(
  calls: readonly DrawCall[],
  entry: string,
  all: readonly string[],
  where: string,
): TextDraw {
  const wanted = entry.trim().toLowerCase();
  // Any other entry that CONTAINS this one's copy would match it too; a run holding
  // one of those is that entry's, not this one's.
  const shadows = all
    .filter((other) => other !== entry)
    .map((other) => other.trim().toLowerCase())
    .filter((other) => other.includes(wanted));
  const runs = drawnTextRuns(calls);
  const found = [...runs, ...textDraws(calls)].filter((draw) => {
    const drawn = draw.text.toLowerCase();
    return (
      drawn.includes(wanted) &&
      !shadows.some((shadow) => drawn.includes(shadow))
    );
  });
  if (found.length === 0) {
    fail(
      `the menu entry "${entry}" drawn on ${where} (specs/ui.md)`,
      runs.map((run) => run.text),
    );
  }
  // The topmost, so a build that draws the same entry twice — a shadow or an outline
  // pass under the run — is read at the run itself rather than at whichever came last.
  return found.reduce((best, draw) => (draw.y < best.y ? draw : best));
}

/** Every entry of `items`, as the runs the frame drew them in, in menu order. */
export function menuDraws(
  calls: readonly DrawCall[],
  items: readonly string[],
  where: string,
): TextDraw[] {
  return items.map((item) => entryDraw(calls, item, items, where));
}

/**
 * The band of canvas one entry occupies, kept clear of its neighbour's.
 *
 * `neighbours` are the other entries' runs on the same frame; the band's half-height
 * is clamped to just inside the nearest of them, so what a reading of this band
 * measures is this entry alone.
 */
export function bandOf(draw: TextDraw, neighbours: readonly TextDraw[]): Band {
  let halfHeight = BAND_HALF_HEIGHT;
  for (const other of neighbours) {
    const gap = Math.abs(other.y - draw.y);
    if (gap > 0) halfHeight = Math.min(halfHeight, gap / 2 - 1);
  }
  halfHeight = Math.max(halfHeight, 1);
  return {
    left: Math.max(0, draw.left - MARKER_MARGIN),
    right: Math.min(FIELD_W - 1, draw.right + MARKER_MARGIN),
    top: Math.max(0, draw.y - halfHeight),
    bottom: Math.min(FIELD_H - 1, draw.y + halfHeight),
  };
}

/** The points a band is read at: a grid over it, in logical field units. */
export function bandPoints(band: Band): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let row = 0; row < BAND_ROWS; row += 1) {
    const y = band.top + ((band.bottom - band.top) * (row + 0.5)) / BAND_ROWS;
    for (let column = 0; column < BAND_COLUMNS; column += 1) {
      const x =
        band.left + ((band.right - band.left) * (column + 0.5)) / BAND_COLUMNS;
      points.push({ x, y });
    }
  }
  return points;
}

/** What the build has painted over a band as the screen stands now. */
export async function readBand(h: Harness, band: Band): Promise<Rgb[]> {
  const read = await h.pixels(bandPoints(band));
  return read.map(([r, g, b]) => ({ r, g, b }));
}

/** How many of a band's samples changed by more than {@link CHANGE_DISTANCE}. */
export function changedSamples(
  before: readonly Rgb[],
  after: readonly Rgb[],
): number {
  let changed = 0;
  for (let i = 0; i < Math.min(before.length, after.length); i += 1) {
    if (colorDistance(before[i], after[i]) > CHANGE_DISTANCE) changed += 1;
  }
  return changed;
}
