// Carom — the trail reading the trail check uses. CASE-PROVIDED.
//
// specs/overview.md fixes one thing about the motion trail: behind the ball, the
// build draws the ball's path over the last `TRAIL_TIME` seconds of travel. How
// it is styled is the build's, and how long the streak looks and how it tapers
// are appearance the reviewer judges, so the reading here is PRESENCE alone:
// whether the lane behind the ball holds anything the flight put there, against a
// reading of the same lane taken before the ball entered it, so that whatever
// static furniture the build draws there (the net, a mode label) is not mistaken
// for the trail.
//
// The field is emptied and one ball is spawned back onto it, so both obstacles
// are off the field entirely rather than shot around; the paddles cannot be
// removed — they are furniture the game always has — so they are stood out of the
// lane, and neither is taken from the player, because a trail is about a ball's
// own travel and needs no driven paddle. That ball is then driven down the lane
// for longer than `TRAIL_TIME`, so the trail is full when it is read. The reading
// is of the pixels the build PAINTED along the lane on the frame the drive ends
// on, and nothing else: how the trail reached the canvas — a path of its own, a
// Path2D, a transformed sprite, an offscreen image — is the build's, and none of
// those name the trail's coordinates in the calls a recorder sees.

import { BALL_R } from "../constants";
import {
  READ_NOISE,
  arrangeLiveBall,
  ball0,
  colorDistance,
  placeBall,
  type Harness,
} from "../harness";

/** The lane the ball is driven down: clear of the parked paddles and of the net. */
export const LANE_Y = 650;

/** Where the drive starts. */
export const START_X = 300;

/** Where the ball waits, still, while the lane is read bare. */
const BARE_X = 1100;

/** Frames of flight before the read: longer than `TRAIL_TIME`, so the trail is full. */
export const FILL_TICKS = 24; // 0.2 s

/** How far behind the ball the lane is looked at, in logical units. */
const SCAN = 240;

/** The closest the scan comes to the ball, so the disc itself is never read. */
const SCAN_FROM = BALL_R + 3;

/** The left edge of the scan: the lane is read bare from here to `BARE_X`. */
const LANE_X0 = 20;

export interface TrailReading {
  /** Where the ball was on the frame that was read. */
  ball: { x: number; y: number };
  /** Whether the lane behind the ball holds anything the flight put there. */
  painted: boolean;
}

/**
 * Drive the ball down the lane at `speed` and read the lane behind it.
 *
 * The lane is read BARE first, with the ball parked far down the lane and still
 * for longer than the trail lives, so the baseline is the field as the build
 * draws it with no trail in it. The ball is then posed at the start of the lane
 * at `speed`, flown for `FILL_TICKS`, and the lane is read again: a pixel is
 * part of the trail when it differs from its own bare reading by more than the
 * rounding two reads of one unchanged pixel carry.
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

  // Posed with the five atomic ball operations `placeBall` sequences, in the order
  // that leaves nothing for the next frame to undo: the hold is ended before the
  // position is written, so the build's own home point cannot overwrite it.
  await placeBall(h, { x: START_X, y: LANE_Y, vx: speed, vy: 0 });
  await h.advance(FILL_TICKS);
  const ball = ball0(await h.snapshot());
  const at = { x: ball.x, y: ball.y };

  return {
    ball: at,
    painted: await paintedBehind(h, at, bare),
  };
}

/** Whether the lane behind the ball holds anything its bare reading did not. */
async function paintedBehind(
  h: Harness,
  ball: { x: number; y: number },
  bare: Map<number, [number, number, number, number]>,
): Promise<boolean> {
  const ballX = Math.round(ball.x);
  const distances: number[] = [];
  for (let d = SCAN_FROM; d <= SCAN; d += 1) {
    if (!bare.has(ballX - d)) break;
    distances.push(d);
  }
  const read = await h.pixels(
    distances.map((d) => ({ x: ballX - d, y: LANE_Y })),
  );
  return distances.some((d, index) => {
    const [r, g, b] = read[index];
    const [br, bg, bb] = bare.get(ballX - d) ?? [r, g, b];
    return colorDistance({ r, g, b }, { r: br, g: bg, b: bb }) > READ_NOISE;
  });
}
