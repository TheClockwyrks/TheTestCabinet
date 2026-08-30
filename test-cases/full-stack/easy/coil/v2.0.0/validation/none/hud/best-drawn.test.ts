// hud/best-drawn — the HUD shows the session's best, under its label.
//
// specs/ui.md gives the HUD a `Best` readout: "`BEST_LABEL` — `BEST`, above the
// session's best score". Both are read, and the figure as a NUMBER, for the same
// reason the score is: a label over a blank is not a readout.
//
// The best is posed well above the live score, which specs/scoring.md requires of
// any best that is to stay where it is put, and which also keeps the two HUD
// figures distinct so neither readout can be mistaken for the other.
//
// The chain is held still and the board is left without a pellet, because what
// this decides is the readout, not the round.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { BEST_LABEL } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { numberRuns, runsOf } from "./band";

/** A best no fresh session carries, above a live score it cannot be confused with. */
const SCORE = 12;
const BEST = 5678;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the posed best with the BEST label above it", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
    score: SCORE,
    best: BEST,
  });
  assertEqual(live.best, BEST, "the best the HUD is asked to show");

  const calls = await h.frameCalls();
  await captureStill(h, "best");

  const figures = numberRuns(calls, BEST);
  const labels = runsOf(calls, BEST_LABEL);
  assertGreaterThan(figures.length, 0, `the HUD drawing the best ${BEST}`);
  assertGreaterThan(labels.length, 0, `the HUD drawing ${BEST_LABEL}`);
  assertLessThanOrEqual(
    Math.min(...labels.map((run) => run.y)),
    Math.min(...figures.map((run) => run.y)),
    `${BEST_LABEL} anchored above the best`,
  );
});
