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

// ---- Input-driven helpers -------------------------------------------------
//
// These drive the game the way a player does — through injected keyboard input
// (window.__carom keyDown/keyUp/press, see specs/instrumentation.md) — rather than
// posing the world with the control ops. Because they never call a control op, the
// game stays under normal keyboard control and the paddles respond to held movement
// keys, which is exactly what a controls check must confirm.

/**
 * Start a real match from the title by navigating the menu with injected keys.
 * `mode` is "solo" (SOLO — the first menu entry, confirmed straight away) or
 * "versus" (VERSUS — one entry down). Leaves the match on its pre-serve countdown,
 * where the paddles already respond to movement input and a pause key still pauses.
 */
export async function startWithKeys(api, mode) {
  await api.reset();
  if (mode === "versus") await api.call("press", "ArrowDown"); // SOLO -> VERSUS
  await api.call("press", "Enter"); // confirm the highlighted entry
}

/**
 * Hold a movement key and report how the given paddle's center y moved. Steps the
 * real sim for a deterministic verdict, then lets real time pass so the clip shows
 * the paddle sliding, then releases the key. `side` is "left" or "right". Returns
 * `{ start, end, delta }` (delta < 0 is upward, > 0 downward).
 */
export async function holdMove(api, side, code, { holdMs = 650 } = {}) {
  const start = (await api.snapshot()).paddles[side].cy;
  await api.call("keyDown", code);
  await api.step(0.3); // deterministic motion the verdict reads
  await api.wait(holdMs); // real time so the paddle visibly slides in the clip
  const end = (await api.snapshot()).paddles[side].cy;
  await api.call("keyUp", code);
  return { start, end, delta: end - start };
}

/**
 * Start a match with keys, play briefly, then press a pause key (`Esc` / `KeyP`)
 * and hold on the result for the clip. Returns the screen after the press.
 */
export async function pauseWith(api, mode, code, { clipMs = 700 } = {}) {
  await startWithKeys(api, mode);
  await api.step(0.2); // settle into the live field
  await api.wait(400); // a moment of visible play before the pause
  await api.call("press", code);
  await api.wait(clipMs); // hold on the pause menu for the clip
  return (await api.snapshot()).screen;
}

/** Toggle mute from the title with the mute key and return `{ before, after }`. */
export async function muteToggle(api, code = "KeyM") {
  await api.reset();
  const before = (await api.snapshot()).muted;
  await api.call("press", code);
  const after = (await api.snapshot()).muted;
  return { before, after };
}

// ---- Serve direction (base + gyre) ----------------------------------------

async function firstServeVx(api) {
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  return (await api.snapshot()).balls[0].vx;
}

/**
 * The serve-direction check shared by the base and gyre variants: the very first
 * serve of every match travels toward player one (vx < 0), and after a point the
 * next serve travels toward the player just scored on. Launches real serves and
 * reads the ball's horizontal direction, then records a clip of a fresh first
 * serve heading left. Returns `{ pass, note }` for the caller to key under its own
 * verdict id.
 */
export async function serveDirectionCheck(api) {
  // First serve of a match always goes toward player one (vx < 0).
  const first1 = await firstServeVx(api);
  const first2 = await firstServeVx(api);
  const firstAlwaysLeft = first1 < 0 && first2 < 0;

  // After player one scores (ball out the RIGHT goal), the next serve travels
  // right, toward the player just scored on.
  await startPlaying(api);
  await driveGoal(api, "right");
  await api.call("serve");
  const afterLeftPoint = (await api.snapshot()).balls[0].vx;

  // After player two scores (ball out the LEFT goal), the next serve travels left.
  await driveGoal(api, "left");
  await api.call("serve");
  const afterRightPoint = (await api.snapshot()).balls[0].vx;

  const receiverRule = afterLeftPoint > 0 && afterRightPoint < 0;
  const pass = firstAlwaysLeft && receiverRule;

  // A clip: a fresh first serve travelling toward player one (leftward).
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.wait(1000);

  return {
    pass,
    note: `first serves vx=${first1.toFixed(0)},${first2.toFixed(0)} (both <0=toward P1); after P1 point vx=${afterLeftPoint.toFixed(0)} (>0 toward receiver R); after P2 point vx=${afterRightPoint.toFixed(0)} (<0 toward receiver L)`,
  };
}
