// progression/starts-zero-score — a new run opens at zero.
//
// `specs/progression.md`, Starting a run: the same table gives Score `0`.
//
// The title is left carrying a score in the thousands before the confirm, which
// is what a title screen carries after a run has ended, so the reading separates
// the models: a build that lays the starting score answers `0`, and one that
// carries the finished run's score into the new one answers `4321`. Posing it is
// safe as a precondition — "`setScore` grants no bonus life, whatever boundary
// it carries the score across" (`specs/instrumentation.md`) — so the lives the
// run opens with are not disturbed by the pose.
//
// The lives and the level the same opening lays are the two points next door.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openRunFrom } from "./run";

/** The score the title is left carrying, well clear of zero. */
const STALE_SCORE = 4321;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("opens a run with a score of zero", async () => {
  await openRunFrom(h, (debug) => debug.setScore(STALE_SCORE));

  await captureStill(h, "opening");
  const opened = await h.snapshot();
  assertEqual(
    opened.screen,
    "playing",
    "precondition: DESCEND opened a run (specs/ui.md)",
  );
  assertEqual(opened.score, 0, "the score the new run reports");
});
