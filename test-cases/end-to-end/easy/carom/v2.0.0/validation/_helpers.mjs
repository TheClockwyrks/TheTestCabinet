// Shared primitives for Carom's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__carom (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then `step` runs the real physics forward and `snapshot` reads
// the outcome back. Nothing fabricates a result. These helpers factor out the
// common "arrange contact, step the real sim, read what happened" patterns and
// the field geometry the scripts depend on (mirrored from the spec / constants).

// Field + ball geometry, from specs/playfield.md and the canonical constants.
export const FIELD_H = 720;
export const FIXED = 1 / 120; // physics timestep (matches FIXED_STEP)

// The paddle half-height and the bottom-bound clamp, so a script can place a ball
// at a known contact height and pin a paddle against the field edge.
export const PADDLE_HALF = 55;
export const PADDLE_MAX_CY = FIELD_H - 55; // 665 — the bottom bound clamp

/**
 * Advance the real simulation in fixed-step chunks until `predicate(snapshot)`
 * holds, or until `maxSeconds` of game time elapse. Returns the last snapshot and
 * whether the predicate was met. `chunk` controls granularity: pass FIXED (one
 * step) when you must read state the instant something happens (a bounce), or a
 * coarser value when the quantity you read is constant between events (rally
 * speed) so the sweep is cheap.
 */
export async function stepUntil(api, predicate, maxSeconds, chunk = FIXED) {
  let snap = await api.snapshot();
  if (predicate(snap)) return { snap, hit: true, steps: 0 };
  const iters = Math.ceil(maxSeconds / chunk);
  for (let i = 0; i < iters; i += 1) {
    await api.step(chunk);
    snap = await api.snapshot();
    if (predicate(snap)) return { snap, hit: true, steps: i + 1 };
  }
  return { snap, hit: false, steps: iters };
}

/** Park both paddles out of the mid-field lane (cy 150) so a shot down y=360 is unobstructed. */
export async function clearPaddles(api) {
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
}

/**
 * Drive a real ball out one goal edge and return the snapshot the instant play
 * leaves the "playing" state (a scored point respawns to countdown, a match point
 * to matchover). `edge` is which edge the ball exits: "right" (x > 1280) scores
 * for player one (left); "left" (x < 0) scores for player two (right). The lane at
 * y=360 clears both obstacles, so the ball reaches the goal without interference.
 */
export async function driveGoal(api, edge) {
  await clearPaddles(api);
  const vx = edge === "right" ? 600 : -600;
  await api.call("setBall", 0, { x: 640, y: 360, vx, vy: 0, spin: 0 });
  const r = await stepUntil(api, (s) => s.screen !== "playing", 3, 0.05);
  return r.snap;
}

/**
 * Arrange a contact against the LEFT paddle and step the real simulation until the
 * ball bounces off its front face (vx turns positive), then return the ball's
 * snapshot the instant it rebounds — before spin decays or curves the flight. The
 * caller poses the paddle (`cy`, `vy`) and the contact height (`ballY`); the real
 * bounce (angle, speed multiply, and spin from the paddle's actual motion) is what
 * produces the returned state. Returns `{ ball, paddle, hit }`.
 */
export async function hitLeftPaddle(
  api,
  { cy = 360, vy = 0, ballY = 360, approachSpeed = 400, startX = 85 } = {},
) {
  await api.call("setPaddle", "left", { cy, vy });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
  await api.call("setBall", 0, {
    x: startX,
    y: ballY,
    vx: -approachSpeed,
    vy: 0,
    spin: 0,
  });
  const r = await stepUntil(api, (s) => s.balls[0].vx > 0, 0.6);
  return { ball: r.snap.balls[0], paddle: r.snap.paddles.left, hit: r.hit };
}

/** Begin a driven versus match already in live play (title -> countdown -> serve). */
export async function startPlaying(api, mode = "versus") {
  await api.reset();
  await api.call("startMatch", mode);
  await api.call("serve");
}
