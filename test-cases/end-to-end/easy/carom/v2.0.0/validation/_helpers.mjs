// Case-specific helpers for Carom's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__carom (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then `step` runs the real physics forward and `snapshot` reads
// the outcome back. Nothing fabricates a result. These helpers factor out the
// common "arrange contact, step the real sim, read what happened" patterns and
// the field geometry the scripts depend on (mirrored from the spec / constants).
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit the driver hands every `drive(api, ttc)` (see
// `packages/browser-driver/ttc.mjs`), the single source of truth shared by every
// case. This file holds only what is specific to Carom. The few helpers that record
// assertions take the script's `check` (from `ttc.checkOne(id)`) and record into it.

// Field + ball geometry, from specs/playfield.md and the canonical constants.
export const FIELD_H = 720;
export const FIELD_W = 1280;
export const FIXED = 1 / 120; // physics timestep (matches FIXED_STEP)

// The fastest the ball can ever travel in real play: the spec caps a paddle
// bounce at `speed = min(speed * 1.04, 980)` (specs/physics.md), and every other
// interaction only rotates or preserves speed, so 980 px/s is the ceiling. Tests
// that probe the integrator at "top speed" use this — the largest value the spec
// actually allows — rather than a value no rally could ever reach.
export const SPEED_CAP = 980;

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

// Off-lane resting spots for the extra balls of a multi-ball build: still corners
// clear of every controlled trajectory the common scripts drive (the y=360 rally
// lane, the y=220/500 obstacle lanes, the top-wall shot), so a parked ball never
// scores and never collides with the controlled ball 0.
const PARK_CORNERS = [
  { x: 30, y: 30 },
  { x: 1250, y: 30 },
  { x: 30, y: 690 },
];

/**
 * In a multi-ball build, park every ball except ball 0 out of the way (a still,
 * off-lane corner), so a single-ball scenario driven on ball 0 is not disturbed by
 * the others. A single-ball build has nothing to park, so this is a no-op there.
 * Posing a ball takes it into live, unheld play, so a parked ball will not relaunch.
 */
export async function neutralizeExtraBalls(api) {
  const { balls } = await api.snapshot();
  for (let i = 1; i < balls.length; i += 1) {
    const c = PARK_CORNERS[(i - 1) % PARK_CORNERS.length];
    await api.call("setBall", i, { x: c.x, y: c.y, vx: 0, vy: 0, spin: 0 });
  }
}

/**
 * Begin a driven versus match already in live play (title -> countdown -> serve),
 * with any extra balls of a multi build parked out of the way so the common
 * single-ball scripts drive ball 0 undisturbed.
 */
export async function startPlaying(api, mode = "versus") {
  await api.reset();
  await api.call("startMatch", mode);
  await api.call("serve");
  await neutralizeExtraBalls(api);
}

/**
 * Drive a REAL straight rally between two stationary, centered paddles and return
 * the ball's speed after each successive real paddle hit. A center hit returns the
 * ball level, so it bounces cleanly back and forth clear of the obstacles; speed is
 * constant between hits, so the sweep steps coarsely until vx reverses (a hit). The
 * two rally checks — that a hit accelerates the ball, and that the speed-up caps at a
 * ceiling — share this drive so they read the same real rally.
 */
export async function rallySpeeds(api, hits = 24) {
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: -500, vy: 0, spin: 0 });

  const speeds = [];
  let prevSign = -1; // ball starts moving left, toward the left paddle
  for (let hit = 0; hit < hits; hit += 1) {
    let snap = await api.snapshot();
    if (Math.sign(snap.balls[0].vx) !== prevSign)
      prevSign = Math.sign(snap.balls[0].vx);
    // Step (coarsely — speed is constant between hits) until vx reverses.
    let reversed = false;
    for (let i = 0; i < 100 && !reversed; i += 1) {
      await api.step(0.05);
      snap = await api.snapshot();
      if (snap.screen !== "playing") break;
      if (Math.sign(snap.balls[0].vx) === -prevSign && snap.balls[0].vx !== 0)
        reversed = true;
    }
    if (!reversed) break;
    speeds.push(snap.balls[0].speed);
    prevSign = -prevSign;
  }
  return speeds;
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
 * Hold a movement key and report how the paddles' center y moved. Steps the real sim
 * for a deterministic verdict, then lets real time pass so the clip shows the paddle
 * sliding, then releases the key. `side` is the paddle under test ("left" or
 * "right"). Returns `{ start, end, delta, otherDelta }` for that paddle (delta < 0 is
 * upward, > 0 downward), plus `otherDelta` — how far EACH paddle moved — so a caller
 * can also confirm a key left the paddle it must not touch still.
 */
export async function holdMove(api, side, code, { holdMs = 650 } = {}) {
  const before = (await api.snapshot()).paddles;
  await api.call("keyDown", code);
  await api.step(0.3); // deterministic motion the verdict reads
  await api.wait(holdMs); // real time so the paddle visibly slides in the clip
  const after = (await api.snapshot()).paddles;
  await api.call("keyUp", code);
  const moved = (s) => after[s].cy - before[s].cy;
  return {
    start: before[side].cy,
    end: after[side].cy,
    delta: moved(side),
    otherDelta: { left: moved("left"), right: moved("right") },
  };
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

// ---- Controls checks (record into the script's `check`) --------------------
//
// Every controls sub-item makes the same one-fact check — a movement key moves a
// paddle, a pause key pauses, the mute key toggles mute — so these three wrappers
// each drive the scenario and record the assertion(s) into the script's `check`
// (from `ttc.checkOne(id)`). Keeping the shape here means every controls script is a
// one-liner and they can never drift. Each uses a comparison matcher, so a failing
// check shows the observed displacement/screen/flag against what it required.

const MOVE_MIN = 40; // a clearly non-trivial paddle displacement, in logical px
const STILL_MAX = 6; // a paddle a key must NOT touch should barely budge, in px

/**
 * A movement-key control check: hold `code` and confirm `side`'s paddle moves the
 * expected way (`up` true = center y decreases). `who` names the paddle for the
 * assertion. When `isolate` is given (the id of the OTHER paddle, only meaningful in
 * Versus, where both paddles are human-driven with no AI), a second assertion
 * confirms that paddle stays still — catching the common bug where a Versus key drives
 * both paddles (e.g. Up/Down moving player one's paddle as well as player two's).
 * Records into `check`.
 */
export async function moveCheck(
  api,
  check,
  { mode, side, code, up, who, isolate },
) {
  await startWithKeys(api, mode);
  const r = await holdMove(api, side, code);
  // `up` must drive cy well past -MOVE_MIN; `down` well past +MOVE_MIN. Recorded as a
  // threshold comparison so a failure shows the actual delta against the bound.
  if (up) {
    check.expectLt(`holding ${code} moves ${who} up (Δcy)`, r.delta, -MOVE_MIN);
  } else {
    check.expectGt(
      `holding ${code} moves ${who} down (Δcy)`,
      r.delta,
      MOVE_MIN,
    );
  }
  if (isolate) {
    const stray = r.otherDelta[isolate];
    check.expectLt(
      `holding ${code} leaves the ${isolate} paddle still (|Δcy|)`,
      Math.abs(stray),
      STILL_MAX,
    );
  }
}

/**
 * A pause-key control check: start a match, play briefly, press `code`, and confirm
 * the game pauses. Records into `check`.
 */
export async function pauseCheck(api, check, { mode, code }) {
  const screen = await pauseWith(api, mode, code);
  check.expectEq(
    `pressing ${code} during play pauses the match`,
    screen,
    "paused",
  );
}

/**
 * The mute-toggle control check: from the title (mute off) a single mute-key press
 * flips `muted` on, then a title screenshot captures the changed mute hint as proof.
 * Records into `check`.
 */
export async function muteCheck(api, check, code = "KeyM") {
  const { before, after } = await muteToggle(api, code);
  await api.wait(200); // let the title redraw with the new mute hint
  await api.screenshot("mute");
  check.expectEq("mute starts off at the title", before, false);
  check.expectEq(`pressing ${code} toggles mute on`, after, true);
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
 * serve heading left. Records its assertions into the script's `check` so the caller
 * returns them under its own verdict id. Each is a signed-direction comparison, so a
 * failure shows the actual vx against the required sign.
 */
export async function serveDirectionCheck(api, check) {
  // First serve of a match always goes toward player one (vx < 0).
  const first1 = await firstServeVx(api);
  const first2 = await firstServeVx(api);
  check.expectLt(
    "first serve of a match travels toward player one (vx)",
    first1,
    0,
  );
  check.expectLt(
    "a second fresh first serve also travels toward player one (vx)",
    first2,
    0,
  );

  // After player one scores (ball out the RIGHT goal), the next serve travels
  // right, toward the player just scored on.
  await startPlaying(api);
  await driveGoal(api, "right");
  await api.call("serve");
  const afterLeftPoint = (await api.snapshot()).balls[0].vx;
  check.expectGt(
    "after player one scores, the serve travels toward the right receiver (vx)",
    afterLeftPoint,
    0,
  );

  // After player two scores (ball out the LEFT goal), the next serve travels left.
  await driveGoal(api, "left");
  await api.call("serve");
  const afterRightPoint = (await api.snapshot()).balls[0].vx;
  check.expectLt(
    "after player two scores, the serve travels toward the left receiver (vx)",
    afterRightPoint,
    0,
  );

  // A clip: a fresh first serve travelling toward player one (leftward).
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.wait(1000);
}
