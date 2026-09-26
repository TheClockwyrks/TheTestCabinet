// gameplay/serve-after-p1 — after a point is scored ON player one, the next
// serve travels toward player one.
//
// The point is a real one: the field is emptied to the one ball, that ball is
// aimed at the LEFT goal, and the build's own simulation carries it out, scoring
// for player two. The hold that follows is then run out with `endHolds`, which
// touches nothing but the timer, and the direction is read on the launch frame
// the build's own serve produces. Nothing is posed about the serve itself, and
// the score is asserted alongside the direction so a build that never scored the
// point cannot pass by serving left out of a countdown it never left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
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

it("serves toward player one after player two scores", async () => {
  await startPlaying(harness);
  await harness.debug.setScore(0, 0);
  await arrangeGoal(harness, "left");

  // The point and the serve that answers it, as one continuous section: the
  // direction only means anything beside the point that decided it.
  await captureReplay(harness, "serve", async () => {
    const point = await driveGoal(harness);
    assertEqual(point.hit, true);
    assertEqual(point.snapshot.score.p2, 1);
    assertEqual(point.snapshot.screen, "countdown");

    await endHolds(harness);
    const launched = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);

    assertEqual(launched.hit, true);
    // Player one defends the LEFT edge: the receiver is the player just scored
    // on.
    assertLessThan(ball0(launched.snapshot).vx, 0);
  });
});
