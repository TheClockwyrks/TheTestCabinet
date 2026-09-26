// serve/park-follows-deflector — a parked ball follows the deflector.
//
// specs/deflector-and-ball.md: "A parked ball sits at radius `194` at the
// deflector's center angle and follows the deflector as it moves." The
// deflector is driven by its own held rotation key — the real motion the
// sentence is about — and the parked ball is read against the deflector's own
// reported angle tick over tick, so the reading is "follows", not any
// particular rotation rate (the rate is the paddle category's item).
//
// THE WORLD IS THE DEFLECTOR AND ITS PARKED BALL, per isolate() and one
// parkBall.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import type { KesslerSnapshot } from "../surface";
import { SERVE_RADIUS } from "../constants";
import { offsetDeg, readBall } from "./reading";

/** How many ticks of held rotation the ball is read across. */
const TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds radius 194 at the deflector's center angle tick over tick", async () => {
  const posed = await isolate(h);
  await h.debug.parkBall();

  const snaps: KesslerSnapshot[] = [];
  await h.keyDown("ArrowRight");
  await h.settleFrame();
  try {
    await captureReplay(h, "follow", async () => {
      for (let i = 0; i < TICKS; i += 1) snaps.push(await h.tick(1));
    });
  } finally {
    await h.keyUp("ArrowRight");
  }

  for (const snap of snaps) {
    assertLength(snap.balls, 1, "the parked ball is the only ball");
    const ball = snap.balls[0];
    assertTrue(ball.parked, "the ball stays parked while it rides");
    const read = readBall(ball);
    assertCloseTo(read.r, SERVE_RADIUS, 2, "the parked ball's center radius");
    assertCloseTo(
      offsetDeg(snap.paddle.angleDeg, read.thetaDeg),
      0,
      1,
      "the parked ball sits at this tick's deflector center angle",
    );
  }
  assertGreaterThan(
    Math.abs(
      offsetDeg(posed.paddle.angleDeg, snaps[TICKS - 1].paddle.angleDeg),
    ),
    5,
    "the deflector actually rotated under the held key, so the ball followed " +
      "a moving target",
  );
});
