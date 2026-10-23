// multi/three-balls — three balls are in play, each on its own home point.
//
// The count and the homes are the whole of this point, read at the two moments
// the specification fixes them: the title screen a `reset` restores, where all
// three sit on their own home points, and the opening of a real match, where all
// three wait on those same points with a hold of their own.
//
// Nothing here poses a ball, and nothing here empties the field. The three balls
// the build places ARE the requirement, so the world under test is the one
// `reset` and the match-start sequence build — a check that cleared the field and
// spawned three balls back would be reading its own arrangement rather than the
// build's. `openTitle` is `reset` alone, and `openCountdown` adds only the mode
// and the screen; neither touches a ball.
//
// Each ball is read by the index it reports rather than by where it sits in the
// array, so three balls stacked on one home fail the point even though every
// entry would sit on some home.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COUNT, BALL_HOMES } from "../constants";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openCountdown,
  openTitle,
  type Harness,
} from "../harness";
import { ballAt, readBalls, waitingAtHomes } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("parks three balls on their own home points and holds them at match start", async () => {
  openTitle(h);
  await h.advance(1);

  const title = readBalls(h.snapshot());
  assertLength(title, BALL_COUNT);
  assertEqual(waitingAtHomes(title), true);

  openCountdown(h, "versus");
  await h.advance(1);
  // The frame the match opens on, with all three balls waiting: the picture this
  // point is about, kept before the assertions so a failing build still shows
  // where it put them.
  captureStill(h, "field");

  const opened = h.snapshot();
  assertLength(readBalls(opened), BALL_COUNT);
  assertEqual(waitingAtHomes(readBalls(opened)), true);

  // Each ball is on ITS OWN home, in play order, and each is waiting out a hold
  // of its own.
  for (let index = 0; index < BALL_COUNT; index += 1) {
    const ball = ballAt(opened, index);
    assertEqual(ball.held, true, `ball ${index} waits at match start`);
    assertCloseTo(ball.x, BALL_HOMES[index].x, 0);
    assertCloseTo(ball.y, BALL_HOMES[index].y, 0);
  }
});
