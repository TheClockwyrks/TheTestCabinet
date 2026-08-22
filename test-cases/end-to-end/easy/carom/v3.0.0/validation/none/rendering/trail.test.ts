// Carom — rendering/trail: the ball leaves a motion trail behind it, one that
// runs continuously back along its recent path, fades with distance, and gets
// longer as the ball gets faster.
//
// A trail is not one shape, so it is read as a sequence: the coordinates the
// frame's draw calls named behind the ball say the render drew something along
// the path, and the pixels along that path say what actually landed there. Both
// are read off the same frame — the recorder injected into the page keeps every
// operation the frame issued, and the operations are what put those pixels there.
//
// The ball is driven down an empty lane near the bottom of the field, clear of
// the paddles, both obstacles, the net, and the HUD, so everything lit in that
// lane behind the ball is the trail and nothing else. The trail represents
// TRAIL_TIME seconds of travel, so its length is the ball's speed times that —
// which is why the same drive is run twice, slow and fast, and the two lengths
// compared. That comparison is the part a single reading cannot fake: a build
// drawing a fixed-length tail passes every absolute bound and fails this.
//
// What the engine-backed project also reads, and this one cannot, is the recent
// path held as STATE — that the build keeps its samples in order, oldest first.
// The state object is the build's own here and the snapshot does not carry the
// trail, so the claim is made from the drawing alone: what the frame drew behind
// the ball, and what landed on the canvas along that lane.
//
// What is not asserted at all is whether it reads as a comet. The capture is for
// a person to judge that; these are the mechanically checkable parts of it.

import { afterEach, beforeEach, expect, it } from "vitest";
import { BALL_R, TRAIL_TIME } from "../constants";
import {
  arrangeLiveBall,
  captureStill,
  colorDistance,
  createHarness,
  drawnPoints,
  sampleColor,
  type DrawCall,
  type Harness,
  type Rgb,
} from "../harness";

/** An empty lane: below both obstacles, clear of the paddles and the net. */
const LANE_Y = 650;

/** Where the ball is posed, and an empty patch of the same lane to read against. */
const START_X = 300;
const BARE_X = 1100;

/** Frames of flight before the frame that is read: longer than the trail's life. */
const FILL_TICKS = 24;

const SLOW = 260;
const FAST = 950;

/** How far a pixel must sit from the bare field to count as lit. */
const LIT_MIN = 10;

/** The widest run of bare field the streak may contain and still be one streak. */
const GAP_MAX = 6;

/** How far behind the ball the lane is read, in logical px. */
const SCAN = 240;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Pose the ball in the lane at `speed`, let it fly long enough to fill the trail,
 * then record exactly one frame. The ball is returned as it was when that frame
 * was drawn, alongside the operations that frame issued.
 */
async function driveTrail(
  speed: number,
): Promise<{ ball: { x: number; y: number }; calls: DrawCall[] }> {
  await arrangeLiveBall(h, { x: START_X, y: LANE_Y, vx: speed, vy: 0 });
  await h.advance(FILL_TICKS);
  // Runs the one frame itself, and hands back what that frame drew.
  const calls = await h.frameCalls();
  const { ball } = await h.snapshot();
  return { ball: { x: ball.x, y: ball.y }, calls };
}

interface Streak {
  /** How far behind the ball the unbroken lit run reaches, in logical px. */
  reach: number;
  /** How much of that run is lit rather than bare. */
  density: number;
  /** How far from the bare field each sampled point read, by distance behind. */
  lit: Map<number, number>;
}

/**
 * Read the lane behind the ball, and report the unbroken run of lit pixels.
 *
 * The whole lane is fetched in one crossing into the page rather than a pixel at
 * a time: two hundred round trips to read one frame would cost more than the
 * drive that produced it, and every sample is off the same finished frame either
 * way.
 */
async function readStreak(ball: { x: number; y: number }): Promise<Streak> {
  const bare = await sampleColor(h, BARE_X, LANE_Y);

  const distances: number[] = [];
  for (let d = BALL_R + 3; d <= SCAN; d += 1) {
    if (ball.x - d < 20) break;
    distances.push(d);
  }
  const read = await h.pixels(
    distances.map((d) => ({ x: ball.x - d, y: ball.y })),
  );

  const lit = new Map<number, number>();
  let reach = 0;
  let gap = 0;
  let count = 0;
  for (const [index, d] of distances.entries()) {
    const [r, g, b] = read[index];
    const level = colorDistance({ r, g, b } as Rgb, bare);
    lit.set(d, level);
    if (level > LIT_MIN) {
      reach = d;
      count += 1;
      gap = 0;
    } else {
      gap += 1;
      if (gap > GAP_MAX) break;
    }
  }
  return { reach, density: reach === 0 ? 0 : count / reach, lit };
}

it("draws a continuous, fading streak back along the ball's recent path", async () => {
  const { ball, calls } = await driveTrail(FAST);
  // The fast pass, where the streak is longest and the taper clearest.
  await captureStill(h, "trail");
  const expected = FAST * TRAIL_TIME;

  // The render asked for geometry behind the ball, in its lane: the trail is a
  // sequence of draws, so where those draws went is the direct reading of it.
  const behind = drawnPoints(calls).filter(
    (point) =>
      Math.abs(point.y - ball.y) <= 20 &&
      point.x < ball.x - BALL_R &&
      point.x > ball.x - SCAN,
  );
  expect(behind.length).toBeGreaterThan(0);
  const drawnReach = Math.max(...behind.map((point) => ball.x - point.x));
  expect(drawnReach).toBeGreaterThan(0.4 * expected);

  // And what landed on the canvas is one unbroken run of about that length.
  const streak = await readStreak(ball);
  expect(streak.reach).toBeGreaterThan(0.5 * expected);
  expect(streak.reach).toBeLessThan(1.5 * expected + 2 * BALL_R);
  expect(streak.density).toBeGreaterThan(0.5);

  // It tapers away from the ball: bright where it meets it, faint at its end.
  const near =
    streak.lit.get(Math.round(BALL_R + 3 + 0.15 * streak.reach)) ?? 0;
  const far = streak.lit.get(Math.round(0.9 * streak.reach)) ?? 0;
  expect(near).toBeGreaterThan(far + 5);
});

it("stretches the streak as the ball speeds up", async () => {
  const slowBall = await driveTrail(SLOW);
  const slow = await readStreak(slowBall.ball);

  const fastBall = await driveTrail(FAST);
  const fast = await readStreak(fastBall.ball);

  expect(slow.reach).toBeGreaterThan(0);
  // The trail is a fixed duration of travel, so at nearly four times the speed it
  // is nearly four times as long. A generous margin, since a build's own glow
  // lights a little of the lane at either speed.
  expect(fast.reach).toBeGreaterThan(slow.reach + 25);
});
