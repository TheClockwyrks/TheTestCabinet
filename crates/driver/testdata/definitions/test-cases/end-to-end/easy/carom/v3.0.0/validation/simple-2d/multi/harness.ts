// Carom (Multi-ball) — the variant-only slice of the harness. CASE-PROVIDED.
//
// `validation/harness.ts` is shared by every variant, so it can only know what
// every variant has. Multi's specification puts three balls on the field instead
// of one, each with its own hold, its own launch and its own respawn, and this
// module is where the checks below reach that.
//
// The shared harness already reaches the ball a shared scenario drives through
// `ball0`, and already empties the field and spawns back exactly the balls a
// check is about through `poseWorld`. What is left here is what only a multi
// check needs: the balls the field currently holds, one of them addressed by the
// index it reports, the hold read off the snapshot, and the sweep a hold is
// measured with.
//
// A BALL IS ADDRESSED BY ITS OWN INDEX, NEVER BY ITS PLACE IN THE ARRAY. The
// arrays a snapshot reports carry only what is present, each entry under its own
// `index` (specs/instrumentation.md), so a check that posed balls 0 and 2 reads
// two entries whose indices are `0` and `2`. That is why nothing here asserts a
// count: how many balls stand on the field is the CHECK's own arrangement, and
// the three-ball field is asserted by the one point that is about it.
//
// Nothing here parks a spare ball anywhere. A ball a check is not about is
// REMOVED by `poseWorld`, because containment in the corner of a goal channel
// leans on exactly the rules a broken build breaks — an escaped spare would make
// one check report another check's defect.

import { BALL_HOMES, HOLD_TIME } from "../constants";
import { assertEqual, assertTruthy } from "../assert";
import { TICK_HZ, allBalls, type BallView, type Harness } from "../harness";
import type { CaromSnapshot } from "../surface";

/** The hold, in frames of the harness's clock. */
export const HOLD_TICKS = HOLD_TIME * TICK_HZ;

/**
 * The margin a measured hold is allowed, in frames: one either side, the review
 * items' "within one frame". It covers whether the frame that opened the hold
 * also counted it down (a menu confirm does, specs/ui.md; the frame a point
 * lands on does not, specs/balls.md) and the float rounding of
 * `HOLD_TIME - n * dt`.
 */
export const HOLD_TOLERANCE_TICKS = 1;

/**
 * Every ball the field currently holds, in play order, checked for shape before
 * a check reads it.
 *
 * No count is asserted: an isolated scenario stands one or two balls on the
 * field, and `multi/three-balls` is the point that says a match has three.
 */
export function readBalls(snapshot: CaromSnapshot): BallView[] {
  assertTruthy(
    snapshot.balls,
    "multi requires snapshot().balls, every ball present in play order " +
      "(specs/instrumentation.md)",
  );
  return allBalls(snapshot);
}

/**
 * Ball `index`, found by the `index` it reports rather than by where it sits in
 * the array.
 *
 * A check that removed the balls it is not about still asks for the one it drove
 * by that ball's own index, and gets a failure naming the missing ball rather
 * than a `TypeError` on the next line.
 */
export function ballAt(snapshot: CaromSnapshot, index: number): BallView {
  const found = readBalls(snapshot).find((ball) => ball.index === index);
  assertTruthy(
    found,
    `snapshot().balls must carry ball ${index} under its own index while it ` +
      `stands on the field; see specs/instrumentation.md`,
  );
  return found as BallView;
}

/**
 * Seconds remaining of ball `index`'s own hold, read back off the snapshot.
 *
 * The hold is each ball's own field in multi (specs/state.md), and the snapshot
 * reports it beside the ball's position, so it is read there rather than dug out
 * of the state the build declared.
 */
export function holdTimerOf(h: Harness, index: number): number {
  const value = ballAt(h.snapshot(), index).holdTimer;
  assertEqual(
    typeof value,
    "number",
    "multi requires each ball's `holdTimer` on the snapshot " +
      "(specs/instrumentation.md)",
  );
  return value;
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
  h: Harness,
  index: number,
  maxFrames = 300,
): Promise<LaunchResult> {
  const swept = await h.until((s) => ballAt(s, index).held === false, {
    maxFrames,
    poll: 1,
  });
  return { hit: swept.hit, frames: swept.frames, snapshot: swept.snapshot };
}

/**
 * Whether every ball given is waiting at its OWN home point, motionless.
 *
 * Each ball is matched to `BALL_HOMES` by the index it reports, so three balls
 * stacked on one point fail even though every entry sits on some home.
 */
export function waitingAtHomes(balls: readonly BallView[]): boolean {
  return balls.every((ball) => {
    const home = BALL_HOMES[ball.index as number];
    if (home === undefined) return false;
    return (
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
