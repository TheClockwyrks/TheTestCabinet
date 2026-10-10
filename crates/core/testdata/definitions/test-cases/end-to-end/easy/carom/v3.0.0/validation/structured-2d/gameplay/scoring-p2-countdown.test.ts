// gameplay/scoring-p2-countdown — the rally restarts after player two scores.
//
// specs/balls.md: on the frame a ball crosses a goal edge the match returns to
// its pre-serve countdown. This point is that SCREEN and nothing else — which
// side receives the next serve is `gameplay/serve-after-p1`'s point, read
// off the serve's own direction, and reading it here too would dock one defect
// two points. The mirror is
// `scoring-p1-countdown`, so a build that restarts correctly on one edge and not
// on the other fails the edge it gets wrong.
//
// The same real point `gameplay/scoring-p2` drives, read for what FOLLOWS it
// rather than for the increment: the ball is aimed at the left goal down the
// middle lane of a field emptied to that one ball, and the build's own scoring
// code decides both. Nothing else is on the field, so nothing but the goal edge
// can decide the shot, and the paddles — the one piece of furniture no operation
// removes — are held clear of the lane.
//
// The increment itself is `gameplay/scoring-p2`'s point: a build that leaves the
// ball where it went out is a build that plays one point and stops, and grading
// the two apart is what says which of the two it is.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  arrangeGoal,
  captureReplay,
  createHarness,
  driveGoal,
  type Harness,
} from "../harness";

/**
 * Frames recorded after the point resolves.
 *
 * `driveGoal` returns on the sample where the screen stops being "playing" — the
 * instant the point lands, which is where the reading has to be taken. Stopping
 * the RECORDING there would cut on the goal itself, so a reviewer would see the
 * ball approach the goal line and never see the countdown open. Half a second of
 * what follows is what makes the clip show a rally RESTARTING.
 *
 * Driven after the sweep, inside the same recorded section, so the snapshot the
 * assertions read is still the sweep's own.
 */
const AFTERMATH_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("opens the countdown after the point", async () => {
  await arrangeGoal(harness, "left");

  const point = await captureReplay(harness, "countdown", async () => {
    const resolved = await driveGoal(harness);
    await harness.advance(AFTERMATH_TICKS);
    return resolved;
  });

  assertEqual(point.hit, true);
  assertEqual(point.snapshot.screen, "countdown");
});
