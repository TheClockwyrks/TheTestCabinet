// Floe — presentation/hud-lives: the HUD's lives readout counts, and a different
// count is drawn differently.
//
// `specs/ui.md`'s HUD table: "Lives | `lives`, the lives the run has left
// counting the critter currently crossing, so a run that has lost none reads
// `3`." What that asks of the drawing is that the readout FOLLOWS THE COUNT: a
// run on its last critter must not look like a run on its first.
//
// WHY THIS IS NOT READ AS TEXT. `specs/ui.md` leaves the HUD's "arrangement and
// styling" to the build, and a lives readout is one of the two the specification
// invites a build to draw without any text at all — three little critters in a
// row is exactly as conformant as the digit `3`, and demanding a digit would
// fail a perfectly good HUD. So the reading is the PIXELS OF THE HUD BAR: pose a
// count, read the bar, and require the bar to be drawn differently for a
// different count. No palette, no glyph, no arrangement and no position is
// required of the readout, because the specification fixes none.
//
// THREE COUNTS, ALL THREE PAIRS. `3` against `2` alone would pass a readout that
// merely says whether a life has been lost; `2` against `1` alone would pass one
// that says whether this is the last critter. Reading `3`, `2` and `1` and
// requiring all three drawings to differ is what makes the readout a COUNT — and
// `3`, `2` and `1` are the three counts a run actually passes through
// (`specs/progression.md` opens a run at `START_LIVES` and takes one per death).
//
// EACH COUNT IS READ FROM ITS OWN FRESH CROSSING, AT THE SAME TICK. The three
// frames are posed identically by `startCrossing` and each is read one tick
// after its own `reset`, so the game time, the score, the level, the timer and
// the five open bays are the same in all three and `lives` is the only thing
// that differs between them. That is what makes a difference in the bar
// attributable to the lives readout rather than to anything the build animates
// there: a difference cannot be the clock, because the clock reads the same in
// all three — and `reset` seeds the randomness (`specs/instrumentation.md`), so
// it cannot be a build's randomly placed ornament either.
//
// ONLY THE HUD BAR IS READ, over `y` in `[0, HUD_H]` (`specs/strait.md`), so
// nothing the build draws on the strait — where `specs/ui.md` puts no readout —
// can supply the difference.
//
// WHAT THIS POINT DOES NOT DECIDE. That a fresh run HAS three lives, and that a
// death takes one, are `progression`'s: `progression/three-lives` and the four
// death items. This point poses the count and reads the drawing.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThanOrEqual,
} from "../assert";
import { HUD_H, START_LIVES, STAGE_W } from "../constants";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Harness,
} from "../harness";
import { differingPixels, readRaster, unitArea, type Raster } from "./raster";

/**
 * How far apart two pixels must be to count as drawn differently, as an RGB
 * distance out of about `441`.
 *
 * Two renderings of the SAME readout are identical to the byte — the two frames
 * are posed alike and read at the same tick — so this bound is not separating
 * signal from noise; it is there so that a build whose readout shifts by a shade
 * a player could never see is not credited with having drawn a different count.
 * Thirty is a fifteenth of the range, well under the contrast any readout must
 * already have against the bar behind it.
 */
const PIXEL_DISTANCE_MIN = 30;

/**
 * How much of the HUD bar must be drawn differently, in square stage units.
 *
 * Twelve — about a `3 x 4` patch of a stage `1280 x 720` units across, inside a
 * bar `80` units tall that carries five readouts. A readout a player can
 * actually count differs by a multiple of that between two counts, even set
 * small: the digit of a readout set at the smallest size anyone would call
 * legible here changes by more, and a row of marks by far more. A readout that
 * ignored the count differs in none of it. It is a floor on "drawn differently
 * at all", not a measure of how the difference should look.
 */
const CHANGED_MIN_UNITS = 12;

/** The counts read: the three a run passes through, most to fewest. */
const COUNTS: readonly number[] = [
  START_LIVES,
  START_LIVES - 1,
  START_LIVES - 2,
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** A fresh crossing with `lives` posed, and the HUD bar it drew one tick later. */
async function barAt(lives: number): Promise<Raster> {
  await startCrossing(h);
  await h.debug.setLives(lives);
  await h.step(1);
  // The situation: the run really holds the count the readout is being read
  // against, still, on the tick the bar below is read from.
  assertEqual(
    (await h.snapshot()).lives,
    lives,
    "the posed lives, read back (specs/instrumentation.md)",
  );
  return readRaster(h, 0, 0, STAGE_W, HUD_H);
}

it("draws the HUD's lives readout differently for each count a run passes through", async () => {
  const bars: { count: number; bar: Raster }[] = [];
  for (const count of COUNTS) bars.push({ count, bar: await barAt(count) });
  // Before the assertions, so a failing verdict still leaves the last bar.
  await captureStill(h, "hud");

  const minChanged = CHANGED_MIN_UNITS * unitArea(bars[0].bar);
  for (let i = 0; i < bars.length; i += 1) {
    for (let j = i + 1; j < bars.length; j += 1) {
      const changed = differingPixels(
        bars[i].bar,
        bars[j].bar,
        PIXEL_DISTANCE_MIN,
      );
      assertGreaterThanOrEqual(
        changed.length,
        minChanged,
        `the device pixels of the HUD bar drawn differently at ` +
          `${bars[i].count} lives and at ${bars[j].count} — the lives readout ` +
          `counts the run's lives (specs/ui.md), and 'lives' is the only ` +
          `thing that differs between the two frames`,
      );
    }
  }

  assertDeepEqual(h.pageErrors, []);
});
