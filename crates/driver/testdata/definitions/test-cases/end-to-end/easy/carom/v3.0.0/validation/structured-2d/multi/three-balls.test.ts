// multi/three-balls — three balls are in play, each on its own home point.
//
// The count and the homes are the whole of this point, read at the two moments
// the specification fixes them: the title screen a `reset` restores, where all
// three sit on their home points, and the opening of a real match, where all
// three wait on those same points with a hold of their own.
//
// Nothing here poses a ball, and nothing here clears the field. `reset` and the
// build's own match start — reached the way a player reaches it, with the menu
// keys — are what put the balls where they are, so what is read back is where the
// BUILD put them rather than where a check put them. That is also why the world
// is left whole: `clearWorld` and `spawnBall` are exactly the operations that
// would answer this question with the check's own arrangement.

import { afterEach, beforeEach, it } from "vitest";
import { BALL_COUNT, BALL_HOMES } from "../constants";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  openTitle,
  startWithKeys,
  type Harness,
} from "../harness";
import { readEveryBall, waitingAtHomes } from "./harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("parks three balls on their own home points and holds them at match start", async () => {
  await openTitle(h);

  const title = readEveryBall(h.snapshot());
  assertLength(title, BALL_COUNT);
  assertEqual(waitingAtHomes(title), true);

  await startWithKeys(h, "versus");
  // The frame the match opens on, with all three balls waiting: the picture this
  // point is about, kept before the assertions so a failing build still shows
  // where it put them.
  captureStill(h, "field");

  const opened = readEveryBall(h.snapshot());
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
