// Carom — the game's one random draw.
//
// The only randomness Carom uses is the angle a ball launches along, drawn
// afresh whenever that ball is parked (specs/balls.md). The draw is a plain
// function of no state: the angle it returns is stored on the ball as
// `launchAngle`, which is what the launch reads and what the debug surface poses
// and reports.

/** A fresh launch angle, uniform over `[0, 2 * PI)` radians. */
export function drawLaunchAngle(): number {
  return Math.random() * 2 * Math.PI;
}
