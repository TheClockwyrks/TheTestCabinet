// Carom — the game's one random draw.
//
// The only randomness Carom uses is the vertical sign of a serve, drawn afresh
// whenever the ball is parked (specs/balls.md). The draw is a plain function of
// no state: the sign it returns is stored on the ball as `serveSign`, which is
// what the serve reads and what the debug surface poses and reports.

/** A fresh serve sign, `1` and `-1` each equally likely. */
export function drawServeSign(): 1 | -1 {
  return Math.random() < 0.5 ? -1 : 1;
}
