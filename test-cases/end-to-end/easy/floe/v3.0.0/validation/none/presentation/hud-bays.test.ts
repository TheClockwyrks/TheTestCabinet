// Floe — presentation/hud-bays: the fifth readout marks each bay, at that bay's
// own place in the row of marks.
//
// `specs/ui.md`'s HUD table fixes the fifth readout: "Bays | One mark per bay, in
// the bays' own left-to-right order, each showing whether that bay is filled."
// Three things, and this point decides all three in the one direction the item
// states: each bay HAS a mark (filling it changes the bar), each bay's mark is
// its OWN (filling one bay leaves every other bay's mark alone), and the marks
// stand in the BAYS' OWN ORDER (`specs/strait.md` lays the five bays out left to
// right, so mark `0` stands left of mark `1`, and so on).
//
// WHY THIS IS NOT READ AS TEXT, OR AS A COLOUR. `specs/ui.md` calls it a mark and
// leaves the HUD's "arrangement and styling" to the build: a filled pip, a lit
// square, a critter icon and a tick are each exactly what was asked for, and none
// of them is text. So the readout is FOUND rather than assumed — the bar is read
// with every bay open, then again with exactly one bay filled, and what moved
// between the two IS that bay's mark. Nothing here names a colour, a shape, a
// size or a place in the bar.
//
// EACH POSE IS ITS OWN FRESH CROSSING, READ AT THE SAME TICK. The six frames —
// the open baseline and one per bay — are posed identically by `startCrossing`
// and each is read one tick after its own `reset`, so the game time and the other
// four readouts are the same in all six and the filled bay is the only thing that
// differs. A difference in the bar therefore cannot be the clock, because the
// clock reads the same in all six — and `reset` seeds the randomness
// (`specs/instrumentation.md`), so it cannot be a build's randomly placed
// ornament either.
//
// ONLY THE HUD BAR IS READ, over `y` in `[0, HUD_H]` (`specs/strait.md`). Filling
// a bay changes the FAR SHORE as well — that is `bays`' business, not this
// readout's — and reading the bar alone keeps the strait's own drawing out of the
// reading entirely.
//
// AND POSING A BAY FILLED CLEARS NO LEVEL. `specs/bays.md` clears a level on the
// HOP that fills the last open bay, so four bays left open and one posed filled
// is a crossing still being played; `bays/posed-full-does-not-clear` is the item
// that grades that.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertGreaterThanOrEqual } from "../assert";
import { BAY_COUNT, HUD_H, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import {
  differingPixels,
  pointAt,
  readRaster,
  unitArea,
  type Raster,
} from "./raster";

/**
 * How far apart two pixels must be to count as drawn differently, as an RGB
 * distance out of about `441`.
 *
 * Two renderings of a mark that did not change are identical to the byte — the
 * frames are posed alike and read at the same tick — so this bound is not
 * separating signal from noise; it is there so that a mark whose "filled" state
 * differs by a shade no player could see is not credited as a mark. Thirty is a
 * fifteenth of the range, well under the contrast a mark showing whether a bay
 * is filled must already carry.
 */
const PIXEL_DISTANCE_MIN = 30;

/**
 * How much of the HUD bar a bay's mark must move, in square stage units.
 *
 * Twelve. `specs/ui.md` asks for five marks side by side inside an `80`-unit bar
 * that also carries four other readouts, so a mark is a small thing by
 * construction; twelve square units is about a `3 x 4` patch, far below anything
 * a player could pick out of a row of five and far above the nothing a bay with
 * no mark of its own moves.
 */
const MARK_MIN_UNITS = 12;

/**
 * How far two bays' marks may overlap horizontally, in stage units.
 *
 * One. `specs/ui.md` gives each bay its own mark in the bays' own left-to-right
 * order, so two marks occupy two spans; the unit of slack is for marks a build
 * sets flush against each other, where the antialiased edge they share belongs to
 * both. It is not room for two bays to share a mark.
 */
const OVERLAP_MAX = 1;

/**
 * How wide a gap between changed columns still belongs to one mark, in stage
 * units.
 *
 * Four. What filling a bay moves is read as the WIDEST unbroken run of columns
 * it moved, not as everything it moved: `specs/ui.md` fixes five readouts and
 * leaves the HUD's arrangement to the build, so a build is free to keep a
 * "bays filled" tally elsewhere in the bar that moves with them, and a check
 * that took the whole span would call that tally part of the mark. Four units is
 * wider than the seam inside any one mark and far narrower than the gap between
 * two of five marks laid across a `1280`-unit bar.
 */
const GAP_MAX = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A fresh crossing with `filled` posed (or none), and the HUD bar it drew. */
async function barWith(filled: number | null): Promise<Raster> {
  await startCrossing(h);
  if (filled !== null) await h.debug.setBay(filled, true);
  await h.step(1);
  const bays = (await h.snapshot()).bays;
  assertDeepEqual(
    bays,
    Array.from({ length: BAY_COUNT }, (_, bay) => bay === filled),
    `the five bays as this frame posed them${
      filled === null ? ", all open" : `, with bay ${filled} filled alone`
    } (specs/instrumentation.md)`,
  );
  return readRaster(h, 0, 0, STAGE_W, HUD_H);
}

/** What filling one bay moved: how much of the bar, and the span it lay in. */
interface Mark {
  bay: number;
  /** Device pixels in the widest unbroken run of columns that moved. */
  pixels: number;
  /** That run's edges, in stage units. */
  left: number;
  right: number;
}

/** The widest unbroken run of the columns a fill moved: that bay's mark. */
function widestRun(xs: readonly number[]): {
  pixels: number;
  left: number;
  right: number;
} {
  const sorted = [...xs].sort((a, b) => a - b);
  let best = { pixels: 0, left: Number.NaN, right: Number.NaN };
  let start = 0;
  for (let i = 1; i <= sorted.length; i += 1) {
    if (i === sorted.length || sorted[i] - sorted[i - 1] > GAP_MAX) {
      const pixels = i - start;
      if (pixels > best.pixels) {
        best = { pixels, left: sorted[start], right: sorted[i - 1] };
      }
      start = i;
    }
  }
  return best;
}

it("marks each bay at its own place in the HUD's row of marks", async () => {
  const open = await barWith(null);
  const marks: Mark[] = [];
  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const filled = await barWith(bay);
    const moved = differingPixels(open, filled, PIXEL_DISTANCE_MIN);
    marks.push({
      bay,
      ...widestRun(moved.map((index) => pointAt(filled, index).x)),
    });
  }
  // Before the assertions, so a failing verdict still leaves the last bar.
  await captureStill(h, "hud");

  // One mark per bay: filling a bay moves something inside the HUD bar.
  const minPixels = MARK_MIN_UNITS * unitArea(open);
  for (const mark of marks) {
    assertGreaterThanOrEqual(
      mark.pixels,
      minPixels,
      `the device pixels of the widest unbroken run of the HUD bar that ` +
        `changed when bay ${mark.bay} alone was posed filled — the bay ` +
        `readout carries one mark per bay, each showing whether that bay is ` +
        `filled (specs/ui.md)`,
    );
  }

  // Each mark is its own, and they stand in the bays' own left-to-right order:
  // the span bay `n` moves begins to the right of where bay `n - 1`'s ends, so
  // no two bays share a mark and filling one leaves the others' alone.
  for (let bay = 1; bay < marks.length; bay += 1) {
    const before = marks[bay - 1];
    const here = marks[bay];
    assertGreaterThanOrEqual(
      here.left,
      before.right - OVERLAP_MAX,
      `the left edge of the mark bay ${bay} moved, against the right edge of ` +
        `bay ${bay - 1}'s at ${before.right.toFixed(0)} — each bay has its ` +
        `own mark and a bay that stays open keeps its own (specs/ui.md)`,
    );
  }

  assertDeepEqual(h.pageErrors, []);
});
