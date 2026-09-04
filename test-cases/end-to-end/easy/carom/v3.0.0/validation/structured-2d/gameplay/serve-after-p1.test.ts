// gameplay/serve-after-p1 — after a point is scored ON player one, the next
// serve travels toward player one.
//
// The point is a real one: the ball is aimed down the middle lane at the LEFT
// goal and the build's own simulation carries it out, scoring for player two.
// The serve that follows is then expired and its direction read on the launch
// frame. Nothing is posed about the serve itself, and the score is asserted
// alongside the direction so a build that never scored the point cannot pass by
// serving left out of a countdown it never left.
//
// THE FIELD HOLDS ONE BALL AND NOTHING ELSE. `arrangeGoal` clears it and spawns
// that ball back, with both paddles held out of the lane, so the flight to the
// goal is a straight line and the point that decides `receiver` is the one this
// check aimed. `receiver` itself is never posed: `setBallHoldTimer` is the only
// thing touched between the point and the launch, and it says nothing about
// which way a serve goes.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLessThan } from "../assert";
import {
  arrangeGoal,
  ball0,
  captureReplay,
  createHarness,
  driveGoal,
  reachPlay,
  type Harness,
} from "../harness";

/**
 * Frames of the served flight recorded after the launch.
 *
 * The direction is read on the launch frame — before a wall or a paddle could
 * turn the ball around — and that instant does not move. A recording that ended
 * there would stop on the frame the ball started moving, so the review item's
 * serve would never be seen to travel; the flight is driven after the reading,
 * inside the same recorded section, where it cannot reach an assertion.
 */
const FLIGHT_TICKS = 90; // 0.75 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("serves toward player one after player two scores", async () => {
  // Opening a match sets both scores to zero (specs/ui.md), so the point below
  // is the first of the match.
  await arrangeGoal(harness, "left");

  // The point and the serve that answers it, as one continuous section: the
  // direction only means anything beside the point that decided it.
  await captureReplay(harness, "serve", async () => {
    const point = await driveGoal(harness);
    assertEqual(point.hit, true);
    assertEqual(point.snapshot.score.p2, 1);
    assertEqual(point.snapshot.screen, "countdown");

    // The hold the point reopened is cut to zero; the LAUNCH is the build's own,
    // on the frame after, and `reachPlay` stops on it.
    const launched = await reachPlay(harness);
    await harness.advance(FLIGHT_TICKS);

    assertEqual(launched.hit, true);
    // Player one defends the LEFT edge: the receiver is the player just scored
    // on.
    assertLessThan(ball0(launched.snapshot).vx, 0);
  });
  assertDeepEqual(harness.assetFailures, []);
});
