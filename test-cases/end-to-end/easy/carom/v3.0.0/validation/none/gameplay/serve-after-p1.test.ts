// gameplay/serve-after-p1 — after a point is scored ON player one, the next
// serve travels toward player one.
//
// The point is a real one: the ball is aimed down the clear lane at the LEFT
// goal and the build's own simulation carries it out, scoring for player two.
// The serve that follows is then expired and its direction read on the launch
// frame. Nothing is posed about the serve itself, and the score is asserted
// alongside the direction so a build that never scored the point cannot pass by
// serving left out of a countdown it never left.

import { afterEach, beforeEach, expect, it } from "vitest";
import {
  arrangeGoal,
  ball0,
  captureReplay,
  createHarness,
  driveGoal,
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
    expect(point.hit).toBe(true);
    expect(point.snapshot.score.p2).toBe(1);
    expect(point.snapshot.screen).toBe("countdown");

    await harness.debug.serve();
    const launched = await harness.until((s) => s.screen === "playing", {
      maxFrames: 60,
      poll: 1,
    });
    await harness.advance(FLIGHT_TICKS);

    expect(launched.hit).toBe(true);
    // Player one defends the LEFT edge: the receiver is the player just scored
    // on.
    expect(ball0(launched.snapshot).vx).toBeLessThan(0);
  });
  // And the page stayed quiet throughout: nothing the build threw, and nothing
  // it logged as an error, while this harness was driving it. An engineless
  // build loads no assets through a runtime, so there is no asset log to read —
  // the browser's own is the wider reading, and it covers the whole drive.
  expect(harness.pageErrors).toEqual([]);
});
