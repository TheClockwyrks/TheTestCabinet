// Carom — the trail reading the two trail checks share. CASE-PROVIDED.
//
// specs/overview.md fixes one thing about the motion trail: behind the ball, the
// build draws the ball's path over the last `TRAIL_TIME` seconds of travel, so
// its length is proportional to the ball's speed. How it is styled is the
// build's. So the reading here is of LENGTH alone: how far behind the ball the
// lane is lit, against a reading of the same lane taken before the ball entered
// it, so that whatever static furniture the build draws there (the net, a mode
// label) is not mistaken for the trail.
//
// The ball is driven down a lane near the bottom of the field, clear of the
// paddles, both obstacles and the net, for longer than `TRAIL_TIME`, so the
// trail is full when it is read. The reading is of the pixels the build PAINTED
// along the lane on the frame the drive ends on, and nothing else: how the
// trail reached the canvas — a path of its own, a Path2D, a transformed
// sprite, an offscreen image — is the build's, and none of those name the
// trail's coordinates in the calls a recorder sees.

import { BALL_R } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  colorDistance,
  type Harness,
} from "../harness";

/** The lane the ball is driven down: clear of both obstacles and the paddles. */
export const LANE_Y = 650;

/** Where the drive starts. */
export const START_X = 300;

/** Where the ball waits, still, while the lane is read bare. */
const BARE_X = 1100;

/** Frames of flight before the read: longer than `TRAIL_TIME`, so the trail is full. */
export const FILL_TICKS = 24; // 0.2 s

/**
 * How far from the bare reading a pixel must be to count as lit, in RGB
 * distance. Small, since the far end of a styled trail is faint, and well above
 * the noise of two reads of the same empty field.
 */
const LIT_MIN = 10;

/**
 * How many unlit pixels in a row end the streak.
 *
 * A trail drawn from samples may be drawn sample by sample, and at the speed
 * cap consecutive samples on the suite's clock are `SPEED_CAP / TICK_HZ`, about
 * eight units, apart; a gap a little wider than that is still the same trail.
 */
const GAP_MAX = 12;

/** How far behind the ball the lane is scanned, in logical units. */
const SCAN = 240;

/** The closest the scan comes to the ball, so the disc itself is never read. */
const SCAN_FROM = BALL_R + 3;

/** The left edge of the scan: the lane is read bare from here to `BARE_X`. */
const LANE_X0 = 20;

export interface TrailReading {
  /** Where the ball was on the frame that was read. */
  ball: { x: number; y: number };
  /** How far behind the ball the painted streak reaches, in logical units. */
  paintedReach: number;
}

/**
 * Drive the ball down the lane at `speed` and read the trail behind it.
 *
 * The lane is read BARE first, with the ball parked far down the lane and still
 * for longer than the trail lives, so the baseline is the field as the build
 * draws it with no trail in it. The ball is then posed at the start of the lane
 * at `speed`, flown for `FILL_TICKS`, and the lane is read again: a pixel is
 * part of the trail when it differs from its own bare reading.
 */
export async function readTrail(
  h: Harness,
  speed: number,
): Promise<TrailReading> {
  await arrangeLiveBall(h, { x: BARE_X, y: LANE_Y, vx: 0, vy: 0 });
  await h.advance(FILL_TICKS);
  const laneXs: number[] = [];
  for (let x = LANE_X0; x < BARE_X - 2 * BALL_R; x += 1) laneXs.push(x);
  const bareRead = await h.pixels(laneXs.map((x) => ({ x, y: LANE_Y })));
  const bare = new Map(laneXs.map((x, i) => [x, bareRead[i]]));

  await h.debug.setBall(0, {
    x: START_X,
    y: LANE_Y,
    vx: speed,
    vy: 0,
    spin: 0,
  });
  await h.advance(FILL_TICKS);
  const ball = ball0(await h.snapshot());
  const at = { x: ball.x, y: ball.y };

  return {
    ball: at,
    paintedReach: await paintedReach(h, at, bare),
  };
}

/** How far behind the ball the lane is lit, against its bare reading. */
async function paintedReach(
  h: Harness,
  ball: { x: number; y: number },
  bare: Map<number, [number, number, number, number]>,
): Promise<number> {
  const ballX = Math.round(ball.x);
  const distances: number[] = [];
  for (let d = SCAN_FROM; d <= SCAN; d += 1) {
    if (!bare.has(ballX - d)) break;
    distances.push(d);
  }
  const read = await h.pixels(
    distances.map((d) => ({ x: ballX - d, y: LANE_Y })),
  );
  let reach = 0;
  let gap = 0;
  for (const [index, d] of distances.entries()) {
    const [r, g, b] = read[index];
    const [br, bg, bb] = bare.get(ballX - d) ?? [r, g, b];
    const level = colorDistance({ r, g, b }, { r: br, g: bg, b: bb });
    if (level > LIT_MIN) {
      reach = d;
      gap = 0;
    } else {
      gap += 1;
      if (gap > GAP_MAX) break;
    }
  }
  return reach;
}
