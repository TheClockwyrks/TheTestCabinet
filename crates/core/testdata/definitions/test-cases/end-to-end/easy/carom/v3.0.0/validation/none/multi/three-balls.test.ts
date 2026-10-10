// multi/three-balls — three balls are in play, each on its own home point.
//
// The count and the homes are the whole of this point, read at the two moments
// the specification fixes them: the title screen a `reset` restores, where all
// three sit parked at their home points, and the opening of a real match, where all three
// wait on those same points with a hold of their own.
//
// NOTHING IS CLEARED AND NOTHING IS SPAWNED HERE, and that is the point of the
// check rather than an omission from it: the world being read IS the one the
// build builds. `reset` places the world exactly as `spawnBall` and
// `spawnObstacle` place it (specs/instrumentation.md), so a check that emptied
// the field and spawned three balls back onto it would read its own arrangement
// and grade nothing. Every other check in this category poses the field it needs;
// this one is the check that the field the build makes for itself is right.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { BALL_COUNT, BALL_HOMES } from "../constants";
import {
  captureStill,
  createMultiHarness,
  openCountdown,
  openTitle,
  type MultiHarness,
} from "../harness";
import { ballAt, readBalls, waitingAtHomes } from "./harness";

let h: MultiHarness;

beforeEach(async () => {
  h = await createMultiHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("parks three balls on their own home points and holds them at match start", async () => {
  await openTitle(h);
  await h.advance(1);

  const title = readBalls(await h.snapshot());
  assertLength(title, BALL_COUNT);
  assertEqual(waitingAtHomes(title), true);

  await openCountdown(h, "versus");
  await h.advance(1);
  // The frame the match opens on, with all three balls waiting: the picture this
  // point is about, kept before the assertions so a failing build still shows
  // where it put them.
  await captureStill(h, "field");

  const opened = await h.snapshot();
  assertLength(readBalls(opened), BALL_COUNT);
  assertEqual(waitingAtHomes(readBalls(opened)), true);

  // Each ball is on ITS OWN home, in play order, rather than three balls stacked
  // on one point — and each is waiting out a hold of its own.
  for (const [index, home] of BALL_HOMES.entries()) {
    const ball = ballAt(opened, index);
    assertEqual(ball.held, true);
    assertCloseTo(ball.x, home.x, 0);
    assertCloseTo(ball.y, home.y, 0);
  }
});
