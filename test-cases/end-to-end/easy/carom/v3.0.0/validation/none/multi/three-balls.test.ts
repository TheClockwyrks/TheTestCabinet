// multi/three-balls — three balls are in play, each on its own home point.
//
// The count and the homes are the whole of this point, read at the two moments
// the specification fixes them: the title screen a `reset` restores, where all
// three sit parked and unheld, and the opening of a real match, where all three
// wait on those same points with a hold of their own.
//
// Nothing here poses a ball. `reset` and `startMatch` are the build's own, so
// what is read back is where the build put its balls rather than where a check
// put them.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { BALL_COUNT, BALL_HOMES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { readBalls, waitingAtHomes } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("parks three balls on their own home points and holds them at match start", async () => {
  await h.debug.reset();
  await h.advance(1);

  const title = readBalls(await h.snapshot());
  assertLength(title, BALL_COUNT);
  assertEqual(waitingAtHomes(title), true);
  for (const ball of title) assertEqual(ball.held, false);

  await h.debug.startMatch("versus");
  await h.advance(1);
  // The frame the match opens on, with all three balls waiting: the picture this
  // point is about, kept before the assertions so a failing build still shows
  // where it put them.
  await captureStill(h, "field");

  const opened = readBalls(await h.snapshot());
  assertLength(opened, BALL_COUNT);
  assertEqual(waitingAtHomes(opened), true);
  for (const ball of opened) assertEqual(ball.held, true);

  // Each ball is on ITS OWN home, in play order, rather than three balls stacked
  // on one point.
  for (const [index, ball] of opened.entries()) {
    assertCloseTo(ball.x, BALL_HOMES[index].x, 0);
    assertCloseTo(ball.y, BALL_HOMES[index].y, 0);
  }
});
