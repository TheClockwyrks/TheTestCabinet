// gameplay/serve-after-p2 — after a point is scored ON player two, the next
// serve travels toward player two.
//
// The mirror of `serve-after-p1`, driven out the RIGHT goal so player one
// scores. Kept as its own check so a build that always serves one way fails the
// side it gets wrong rather than averaging out across the two.
//
// THE FIELD HOLDS ONE BALL AND NOTHING ELSE. `arrangeGoal` clears it and spawns
// that ball back, with both paddles held out of the lane, so the flight to the
// goal is a straight line and the point that decides `receiver` is the one this
// check aimed. `receiver` itself is never posed: `setBallHoldTimer` is the only
// thing touched between the point and the launch, and it says nothing about
// which way a serve goes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
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

it("serves toward player two after player one scores", async () => {
  // Opening a match sets both scores to zero (specs/ui.md), so the point below
  // is the first of the match.
  await arrangeGoal(harness, "right");

  // The point and the serve that answers it, as one continuous section: the
  // direction only means anything beside the point that decided it.
  await captureReplay(harness, "serve", async () => {
    const point = await driveGoal(harness);
    assertEqual(point.hit, true);
    assertEqual(point.snapshot.score.p1, 1);
    assertEqual(point.snapshot.screen, "countdown");

    // The hold the point reopened is cut to zero; the LAUNCH is the build's own,
    // on the frame after, and `reachPlay` stops on it.
    const launched = await reachPlay(harness);
    await harness.advance(FLIGHT_TICKS);

    assertEqual(launched.hit, true);
    // Player two defends the RIGHT edge: the receiver is the player just scored
    // on.
    assertGreaterThan(ball0(launched.snapshot).vx, 0);
  });
});
