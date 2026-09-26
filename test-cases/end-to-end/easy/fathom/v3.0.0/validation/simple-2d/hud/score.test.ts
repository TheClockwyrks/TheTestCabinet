// hud/score — the running score is on the top strip, and it follows the state.
//
// specs/ui.md keeps the score in the top strip, `y` in `[0, 80]`, whenever a maze
// is on screen. What this reads is that the figure is DRAWN, that it is drawn in
// that strip, that it is the figure the snapshot reports at the same moment, and
// that it can be seen where it stands. Where inside the strip it sits, what color
// it is and what type it is set in are the build's, and specs/ui.md says so.
//
// THE FIGURE IS POSED WELL AWAY FROM ZERO. A dive opens on `0`, and `0` appears
// somewhere in almost any run of text a HUD draws — a depth, a cooldown, a padded
// figure — so a check that read a fresh dive's score would pass on nothing. The
// posed figure has no run of digits any other readout carries.
//
// AND HOW THE FIGURE IS WRITTEN IS THE BUILD'S. The readout is found by the
// FIGURE, in any of the ways a build writes one, so a score drawn with its digit
// triples grouped — `4,731`, which is what `Number.prototype.toLocaleString()`
// writes by default — is read as carrying the score just as `4731` is. The ASCII
// space is not one of the separators, because two figures drawn side by side are
// two readings rather than one; `figures.ts` states that in full.
//
// AND IT IS READ AGAIN AFTER A MOUTHFUL, so the readout is shown to FOLLOW the
// state rather than to have been drawn once. The plankton is laid on a tile beside
// the forager and the forager put on it, which is the eating specs/gameplay.md
// defines; what a mouthful PAYS is `scoring.plankton`'s point, so the second
// reading is taken against whatever the snapshot then reports.
//
// THE BOARD IS EMPTIED OF HUNTERS, so nothing can reach the forager and end the
// dive between the two readings, and of plankton, so the one this check lays is
// the only one the forager can reach.

import { afterEach, beforeEach, it } from "vitest";

import { assertGreaterThan, assertNotNull, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { corridorDirs, stepTile } from "../maze";
import { textRuns } from "../text";
import { frameOps } from "../states/screens";
import {
  LEGIBLE_MIN,
  TOP_STRIP,
  figureReadoutOf,
  legibility,
} from "./readouts";
import { ticks } from "../harness";

/**
 * The score the dive is posed onto.
 *
 * Three figures that no other readout on the HUD carries: not a depth, not a
 * life count, not a cooldown, and nowhere inside the padded zeroes a build may
 * draw a fresh score with.
 */
const POSED_SCORE = 4731;

/** Ticks allowed for a mouthful once the forager stands on the plankton. */
const EAT_TICKS = ticks(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the score in the top strip, legibly, and follows it", async () => {
  await startPlaying(h);
  h.debug.clearPredators();
  h.debug.clearPlankton();
  h.debug.setScore(POSED_SCORE);

  const posed = h.snapshot();
  const drawn = textRuns(await frameOps(h));
  // Before the assertions, so a failing check still leaves the HUD it read.
  captureStill(h, "hud");

  const run = figureReadoutOf(drawn, TOP_STRIP, posed.score);
  assertNotNull(
    run,
    `a run of text carrying the score ${String(posed.score)} the snapshot ` +
      `reports, drawn with its anchor in the top strip y in ` +
      `[${String(TOP_STRIP.y0)}, ${String(TOP_STRIP.y1)}] (specs/ui.md)`,
  );
  if (run === null) return;
  assertGreaterThan(
    await legibility(h, run),
    LEGIBLE_MIN,
    "the RGB distance of the score's own furthest pixel from the strip " +
      `behind it, out of 441, sampled across the run drawn at ` +
      `(${run.x.toFixed(0)}, ${run.y.toFixed(0)}) (specs/ui.md)`,
  );

  // A mouthful, so the readout is shown to follow the state.
  const ways = corridorDirs(posed, posed.forager.tx, posed.forager.ty);
  assertTrue(
    ways.length > 0,
    "a corridor tile beside the forager to lay the mouthful on, on the board " +
      "the game laid out",
  );
  if (ways.length === 0) return;
  const bite = stepTile(posed, posed.forager.tx, posed.forager.ty, ways[0]);
  h.debug.setPlankton(bite.tx, bite.ty, true);
  h.debug.setForagerTile(bite.tx, bite.ty);
  await h.advance(EAT_TICKS);

  const eaten = h.snapshot();
  assertGreaterThan(
    eaten.score,
    posed.score,
    "the score the snapshot reports once the forager has eaten, which is the " +
      "figure the readout then has to carry",
  );
  const after = textRuns(await frameOps(h));
  assertNotNull(
    figureReadoutOf(after, TOP_STRIP, eaten.score),
    `a run of text carrying the new score ${String(eaten.score)} in the top ` +
      "strip, once the forager has eaten a plankton (specs/ui.md)",
  );
});
