// Wireworm — presentation/hud-score: the HUD shows the running score.
//
// specs/ui.md's HUD table: the bar carries three readouts, and the score is "the
// running score, as digits. It is the most prominent of the three."
// specs/board.md puts every one of them inside the bar's own region, `y` in
// `[0, HUD_H]` (`[0, 80]`). specs/scoring.md fixes what the score becomes; this
// point asks only that whatever it IS is on the bar, in digits a player reads.
//
// THE READING IS THE FRAME'S OWN TEXT DRAWS, each placed in logical units
// through the transform it was drawn under, so a build is free to set its
// readout in any face, at any size, anywhere in the bar. A run COUNTS when the
// digits in it read as the posed score: a label around it (`SCORE 12345`), a
// grouping separator (`12,345`), and zero padding (`0012345`) all read as that
// score, and none of them is a thing the specification fixes.
//
// THE POSED SCORE IS THE DISTINGUISHING VALUE. `12,345` is five digits with no
// run of them anywhere else on the bar: the level readout carries `1` and
// `TOTAL_LEVELS` (`12`) and the lives readout carries `START_LIVES` (`3`), so
// nothing but the score readout can produce this figure, and a build that drew a
// stale or a rounded score reads as a different number rather than as this one.
//
// The board beneath is empty and quiet, so nothing on it can reach the bar.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { HUD_H } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  textDrawForms,
  type Harness,
} from "../harness";

/** The score posed: five digits no other readout on the bar can produce. */
const POSED_SCORE = 12345;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("draws the posed score inside the HUD bar", async () => {
  await startPlaying(h);
  await h.debug.setScore(POSED_SCORE);

  // The frame's calls and the runs they spell, so a score the build
  // letter-spaced a digit per call is read off the run those digits coalesce
  // into.
  const draws = textDrawForms(await h.frameCalls());
  // The HUD bar carrying the posed score.
  await captureStill(h, "hud");

  assertEqual(
    (await h.snapshot()).score,
    POSED_SCORE,
    "the posed score landed",
  );

  const onBar = draws.filter((draw) => draw.y >= 0 && draw.y <= HUD_H);
  const reading = onBar.filter(
    (draw) => Number.parseInt(draw.text.replace(/\D/g, ""), 10) === POSED_SCORE,
  );
  assertGreaterThan(
    reading.length,
    0,
    `a run of text inside the HUD bar (y in [0, ${HUD_H}]) whose digits read ` +
      `${POSED_SCORE} (specs/ui.md: the score is the running score, as ` +
      `digits, drawn inside the bar); the bar's runs were ` +
      `${JSON.stringify(onBar.map((draw) => draw.text))}`,
  );
});
