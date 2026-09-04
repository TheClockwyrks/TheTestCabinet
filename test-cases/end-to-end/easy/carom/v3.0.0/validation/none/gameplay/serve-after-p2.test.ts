// gameplay/serve-after-p2 — after a point is scored ON player two, the next
// serve travels toward player two.
//
// The mirror of `serve-after-p1`, driven out the RIGHT goal so player one
// scores. Kept as its own check so a build that always serves one way fails the
// side it gets wrong rather than averaging out across the two.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  arrangeGoal,
  ball0,
  captureReplay,
  createHarness,
  driveGoal,
  endHolds,
  startPlaying,
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

afterEach(async () => {
  await harness.dispose();
});

it("serves toward player two after player one scores", async () => {
  await startPlaying(harness);
  await harness.debug.setScore(0, 0);
  await arrangeGoal(harness, "right");

  // The point and the serve that answers it, as one continuous section: the
  // direction only means anything beside the point that decided it.
  await captureReplay(harness, "serve", async () => {
    const point = await driveGoal(harness);
    assertEqual(point.hit, true);
    assertEqual(point.snapshot.score.p1, 1);
    assertEqual(point.snapshot.screen, "countdown");

    await endHolds(harness);
    const launched = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);

    assertEqual(launched.hit, true);
    // Player two defends the RIGHT edge: the receiver is the player just scored
    // on.
    assertGreaterThan(ball0(launched.snapshot).vx, 0);
  });
  // And the page stayed quiet throughout: nothing the build threw, and nothing
  // it logged as an error, while this harness was driving it. An engineless
  // build loads no assets through a runtime, so there is no asset log to read —
  // the browser's own is the wider reading, and it covers the whole drive.
  assertDeepEqual(harness.pageErrors, []);
});
