// hud/score-drawn — the HUD shows the score, under its label.
//
// specs/ui.md gives the HUD a `Score` readout: "`SCORE_LABEL` — `SCORE`, above
// the current score". So both are read, and the figure is read as a NUMBER rather
// than as the presence of a label: a HUD that says `SCORE` over a blank tells a
// player nothing, and a HUD that draws a figure that never changes tells them
// something false.
//
// The score is posed at a figure no part of a fresh round could produce, and the
// best is posed above it so specs/scoring.md leaves the best where it is — a best
// below the live score would be raised to it, and the two readouts would then
// carry the same number and neither could be told from the other.
//
// The chain is held still and the board is left without a pellet, because what
// this decides is the readout, not the round.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { SCORE_LABEL } from "../constants";
import {
  HOME_HEAD,
  captureStill,
  chainFrom,
  createHarness,
  poseScene,
  type Harness,
} from "../harness";
import { drewText } from "../case-harness/text";
import { linesOf, numberRuns } from "./band";

/** A score no fresh round reaches, and a best above it so it stays put. */
const SCORE = 1234;
const BEST = 5678;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the posed score with the SCORE label above it", async () => {
  const live = await poseScene(h, {
    snake: chainFrom(HOME_HEAD, "right", 4),
    dir: "right",
    pellet: null,
    travel: false,
    score: SCORE,
    best: BEST,
  });
  assertEqual(live.score, SCORE, "the score the HUD is asked to show");

  const calls = await h.frameCalls();
  await captureStill(h, "score");

  const figures = numberRuns(calls, SCORE);
  assertEqual(
    drewText(calls, SCORE_LABEL),
    true,
    `the HUD drawing ${SCORE_LABEL}`,
  );
  const labels = linesOf(calls, SCORE_LABEL);
  assertGreaterThan(figures.length, 0, `the HUD drawing the score ${SCORE}`);
  assertLessThanOrEqual(
    Math.min(...labels.map((run) => run.y)),
    Math.min(...figures.map((run) => run.y)),
    `${SCORE_LABEL} anchored above the score`,
  );
});
