// progression/starts-zero-score — a new run opens at a score of zero.
//
// specs/progression.md, Starting a run: a new run opens with a score of `0`. The
// run is opened the way a player opens one, through `confirm` on `DESCEND`
// (specs/ui.md).
//
// THE POSE IS THE DISTINGUISHING VALUE. `reset` already leaves a score of `0` on
// the title screen, so the title is left holding a score a previous run might
// have finished on: a build whose `DESCEND` opened no run, or one that carried a
// previous run's score into a new one, reads that number back, and only a build
// that ran the start-of-run rule reads `0`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  tapAction,
  type Harness,
} from "../harness";

/**
 * The score the title is left holding before `DESCEND` is confirmed.
 *
 * `setScore` is a precondition and grants no bonus life (specs/instrumentation.md),
 * so posing it changes nothing but the figure itself. The value is deliberately
 * not a multiple of `BONUS_LIFE_EVERY` and not `0`, so it is unmistakable in a
 * failure message.
 */
const STALE_SCORE = 4321;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens a run at a score of zero", async () => {
  resetTo(h);
  h.debug.setScore(STALE_SCORE);

  await tapAction(h, "confirm");
  captureStill(h, "opening");

  assertEqual(h.snapshot().score, 0);
});
