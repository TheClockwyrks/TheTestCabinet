// ball/already-leaving-wall — a wall the ball is already leaving does not
// reverse it.
//
// specs/balls.md's wall rule fires only on a ball travelling INTO the wall: the
// top wall needs `y - BALL_R < 0` AND `vy < 0`. So a ball posed across the top
// wall while already travelling down keeps going, and a build that reads only
// the overlap traps it against the wall instead.
//
// THE READING IS EXACT. The ball is posed across the top wall with `vy`
// downward, one frame is advanced — the frame the resolution runs in — and `vy`
// is read back unchanged, because the wall rule leaves speed and spin alone and
// this ball never satisfies its condition.
//
// The end-cap form of the same guard is `ball/already-leaving-cap`'s point: a
// different rule, a different component and a different resolution, so a build
// that gets one right and the other wrong is graded as such.
//
// The scenario runs over a field emptied to the one ball, with the obstacles off
// it and both paddles held out of the lane, so what the ball meets is the wall
// and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual } from "../assert";
import { BALL_R, FIELD_CX } from "../constants";
import {
  PARKED_CY,
  ball0,
  captureReplay,
  createHarness,
  isolateBall,
  placeBall,
  startPlaying,
  takePaddle,
  type Harness,
} from "../harness";

/** How far past the top wall the ball is posed, in units. */
const WALL_OVERLAP = 3;
/** The speed the ball is posed at, in units per second. */
const SPEED = 300;

/** Frames recorded after the reading, so the clip shows the ball leaving. */
const AWAY_TICKS = 120; // 1 s

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a vy that already points out of the wall it overlaps", async () => {
  await startPlaying(h, "versus");

  await isolateBall(h);
  await takePaddle(h, "left", 0);
  await h.debug.setPaddleCy("left", PARKED_CY);
  await takePaddle(h, "right", 0);
  await h.debug.setPaddleCy("right", PARKED_CY);
  await placeBall(h, {
    x: FIELD_CX,
    y: BALL_R - WALL_OVERLAP,
    vx: 0,
    vy: SPEED,
  });

  const leaving = await captureReplay(h, "leaving", async () => {
    await h.advance(1);
    const measured = ball0(await h.snapshot());
    await h.advance(AWAY_TICKS);
    return measured;
  });

  assertEqual(leaving.held, false);
  assertCloseTo(leaving.vy, SPEED, 6);
});
