// Carom (Multi-ball) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know what
// every variant has. Multi's specification puts three balls on the field instead
// of one, each under its own INDEX, with its own hold, its own launch and its
// own respawn, and this module is where the checks below reach that.
//
// The shared harness already hands out `createMultiHarness` and `MultiHarness`,
// whose six ball operations take that index, and `clearField` already empties
// the field. What is left here is what only a multi check needs.
//
// A BALL IS REACHED BY ITS INDEX, NEVER BY ARRAY POSITION. `snapshot().balls`
// carries only the balls PRESENT, each entry under its own `index`
// (specs/instrumentation.md), and a scenario that clears the field back to the
// one or two balls its requirement is about therefore reads a shorter array
// whose entries are not where a three-ball array would have put them. So the
// count is asserted by the checks that spawn all three, and every read goes
// through {@link ballAt}.
//
// The narrowing is safe by construction: these checks only ever run against a
// multi build, whose specification requires exactly what is read here.

import { assertEqual, assertTruthy } from "../assert";
import { BALL_HOMES, HOLD_TIME } from "../constants";
import {
  TICK_HZ,
  allBalls,
  clearField,
  type BallView,
  type CaromSnapshot,
  type MultiHarness,
} from "../harness";

/** Every ball of a full field, in play order: the indices a match is played with. */
export const BALLS_IN_PLAY: readonly number[] = BALL_HOMES.map(
  (_home, index) => index,
);

/** The hold, in frames of the harness's clock. */
export const HOLD_TICKS = HOLD_TIME * TICK_HZ;

/**
 * The margin a measured hold is allowed, in frames.
 *
 * One either side, the same margin the single-ball countdown is measured with:
 * the frame a pose, a menu confirm or the point itself was delivered on also
 * counts the hold down (specs/balls.md), and 120 subtractions of a
 * hundred-and-twentieth round either side of zero.
 */
export const HOLD_TOLERANCE_TICKS = 1;

/** Every ball a snapshot reports, checked for shape before a check reads them. */
export function readBalls(snapshot: CaromSnapshot): BallView[] {
  assertEqual(
    Array.isArray(snapshot.balls),
    true,
    "multi requires snapshot().balls, every ball present in play order " +
      "(specs/instrumentation.md)",
  );
  return allBalls(snapshot);
}

/**
 * The ball carrying `index`, failing by name when the field does not report it.
 *
 * Found by its `index` rather than taken from position `index`, because the
 * array holds what the scenario left on the field: a check that cleared back to
 * balls zero and one reads two entries, and asking for ball one by position
 * would answer with a two-entry array's second element whatever index it
 * carries.
 */
export function ballAt(snapshot: CaromSnapshot, index: number): BallView {
  const ball = readBalls(snapshot).find(
    (candidate) => candidate.index === index,
  );
  assertTruthy(
    ball,
    `snapshot().balls must report ball ${index}, which spawnBall(${index}) placed ` +
      "(specs/instrumentation.md)",
  );
  return ball as BallView;
}

/**
 * Empty the field and spawn back exactly the named balls, and nothing else.
 *
 * Multi's counterpart of the shared harness's {@link isolateBall}: each ball
 * comes back the way `spawnBall(index)` places it — on its own home point, held,
 * with a full hold timer and an empty trail, which is the arrangement a match
 * opens on. A scenario about a launch or a hold leaves them exactly so and lets
 * the build count them down; one about a ball in flight poses it with
 * `placeBall`.
 *
 * The obstacles do not come back, because no check in this category is about
 * one. A check that needs an obstacle names it through the shared
 * `spawnObstacles`.
 */
export async function isolateBalls(
  h: MultiHarness,
  indices: readonly number[] = BALLS_IN_PLAY,
): Promise<void> {
  await clearField(h);
  for (const index of indices) await h.debug.spawnBall(index);
}

/** What a hold sweep found: whether the ball launched, and after how many frames. */
export interface LaunchResult {
  hit: boolean;
  /** Frames advanced before the sample the ball was first seen in flight in. */
  frames: number;
  snapshot: CaromSnapshot;
}

/**
 * Advance one frame at a time until ball `index` is no longer held, and report
 * the frame it left on.
 *
 * Frame by frame because the count IS the measurement: a coarser poll would
 * report the hold as however long the sweep happened to overshoot it by.
 */
export async function driveLaunch(
  h: MultiHarness,
  index: number,
  maxFrames = 300,
): Promise<LaunchResult> {
  const swept = await h.until((s) => ballAt(s, index).held === false, {
    maxFrames,
    poll: 1,
  });
  return { hit: swept.hit, frames: swept.frames, snapshot: swept.snapshot };
}

/** Whether every ball present is waiting at its own home point, motionless. */
export function waitingAtHomes(balls: readonly BallView[]): boolean {
  return balls.every((ball, position) => {
    const home = BALL_HOMES[ball.index ?? position];
    return (
      home !== undefined &&
      Math.abs(ball.x - home.x) <= 1 &&
      Math.abs(ball.y - home.y) <= 1 &&
      Math.abs(ball.vx) <= 1 &&
      Math.abs(ball.vy) <= 1
    );
  });
}

/** The angle of a launch from horizontal, in degrees, keeping its direction. */
export function launchAngleDeg(ball: BallView): number {
  return (Math.atan2(ball.vy, ball.vx) * 180) / Math.PI;
}
