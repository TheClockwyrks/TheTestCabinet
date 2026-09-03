// gameplay/serve-after-p2 — after a point is scored ON player two, the next
// serve travels toward player two.
//
// The mirror of `serve-after-p1`, driven out the RIGHT goal so player one
// scores. Kept as its own check so a build that always serves one way fails the
// side it gets wrong rather than averaging out across the two.
//
// The point runs down an isolated lane. `arrangeGoal` empties the field and
// spawns back the one ball it fires, so both obstacles are gone rather than
// dodged, and it drives both paddles out of the mid-field lane. The serve that
// answers the point leaves the same field: nothing respawns what was cleared, so
// the launch that is read is the ball on an otherwise empty court.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeGoal,
  ball0,
  captureReplay,
  createHarness,
  driveGoal,
  driveServe,
  enterPlaying,
  stageServe,
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
  enterPlaying(harness);
  harness.debug.setScore(0, 0);
  arrangeGoal(harness, "right");

  // The point and the serve that answers it, as one continuous section: the
  // direction only means anything beside the point that decided it.
  await captureReplay(harness, "serve", async () => {
    const point = await driveGoal(harness);
    assertEqual(point.hit, true);
    assertEqual(point.snapshot.score.p1, 1);
    assertEqual(point.snapshot.screen, "countdown");

    // The hold is cut to nothing; the LAUNCH is the build's own, on the frame
    // after, and `receiver` is not touched by either pose.
    stageServe(harness);
    const launched = await driveServe(harness);
    await harness.advance(FLIGHT_TICKS);

    assertEqual(launched.hit, true);
    // Player two defends the RIGHT edge: the receiver is the player just scored
    // on.
    assertGreaterThan(ball0(launched.snapshot).vx, 0);
  });
  assertDeepEqual(harness.assetFailures, []);
});
