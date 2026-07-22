// Case-specific helpers for Carom's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__carom (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then time runs the real physics forward and `snapshot` reads the
// outcome back. Nothing fabricates a result.
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time
// instant to decide the verdict, once in real time to record the media — and the
// runtime enforces the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` — control ops and instant reads only. Callable from
//     `arrange`, runs in BOTH passes, so the record pass reaches `act` in exactly
//     the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns
//     the outcome the assertions read. Callable from `act`, and the only part
//     filmed.
//   * `assertX(check, outcome, ...)` — records the assertion(s) into the script's
//     `check`. Validate pass only.
//
// A helper that only poses state (`clearPaddles`, `startPlaying`,
// `neutralizeExtraBalls`, `startWithKeys`) is unpaired: it is arrange-callable on
// its own. Everything else comes in an `arrangeX` / `actX` PAIR, named for the same
// scenario, and the two halves must be used together — the act half assumes its
// arrange half posed the world.
//
// UNITS ARE TICKS. Carom is a 120 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every duration below is a tick count (the runtime converts
// to wall-clock for the record pass). The seconds these replace are noted inline.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit (`packages/browser-driver/ttc.mjs`), the single source of truth shared
// by every case. This file holds only what is specific to Carom.

// Field + ball geometry, from specs/playfield.md and the canonical constants.
export const FIELD_H = 720;
export const FIELD_W = 1280;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed physics step (this replaces the old `FIXED = 1/120` seconds constant);
// pass `poll: TICK` to `api.until` when the exact instant of an event matters.
export const TICK_HZ = 120;
export const TICK = 1;

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

// ---- State-only helpers (arrange) ------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/** Park both paddles out of the mid-field lane (cy 150) so a shot down y=360 is unobstructed. */
export async function clearPaddles(api) {
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
}

// Off-lane resting spots for the extra balls of a multi-ball build: still corners
// clear of every controlled trajectory the common items drive (the y=360 rally
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
 * single-ball items drive ball 0 undisturbed.
 */
export async function startPlaying(api, mode = "versus") {
  await api.reset();
  await api.call("startMatch", mode);
  await api.call("serve");
  await neutralizeExtraBalls(api);
}

// ---- Goals -----------------------------------------------------------------

/**
 * ARRANGE half of the goal drive: aim a real ball at one goal edge. `edge` is which
 * edge the ball will exit: "right" (x > 1280) scores for player one (left); "left"
 * (x < 0) scores for player two (right). The lane at y=360 clears both obstacles, so
 * the ball reaches the goal without interference.
 *
 * Pair with `actGoal`.
 */
export async function arrangeGoal(api, edge) {
  await clearPaddles(api);
  // Re-park any extra balls of a multi build right before the drive. The initial
  // neutralize happens once in `startPlaying`, but a `serve()` between drives (the
  // deuce check re-serves out of the post-point countdown) — or any build that
  // relaunches a ball sitting at rest — can put a parked ball back in motion, and a
  // stray ball reaching a goal would score a point this drive never intended. A
  // single-ball build has nothing to park, so this is a no-op there.
  await neutralizeExtraBalls(api);
  const vx = edge === "right" ? 600 : -600;
  await api.call("setBall", 0, { x: 640, y: 360, vx, vy: 0, spin: 0 });
}

/**
 * ACT half of the goal drive: run the real physics until play leaves the "playing"
 * state (a scored point respawns to countdown, a match point to matchover) and
 * return the snapshot at that instant. Polls coarsely — nothing read here changes
 * between the launch and the goal.
 *
 * Pair with `arrangeGoal`. Returns the snapshot (what the old `driveGoal` returned).
 */
export async function actGoal(api, { max = 360, poll = 6 } = {}) {
  // 360 ticks = the old 3s cap; poll 6 = the old 0.05s chunk.
  const r = await api.until((s) => s.screen !== "playing", { max, poll });
  return r.snap;
}

// ---- Paddle contact --------------------------------------------------------

/**
 * ARRANGE half of a paddle contact on `side` ("left" or "right"): pose that paddle
 * (`cy`, `vy`) and an incoming ball aimed straight at its front face at height
 * `ballY`. The ball starts just in front of the struck paddle and travels toward it
 * — a left paddle is approached from its right (the ball moving left), a right paddle
 * from its left (moving right) — with the opposite paddle parked out of the lane. The
 * real bounce — angle, speed multiply, and spin from the paddle's actual motion — is
 * what `actPaddleHit` then reads back; nothing about the rebound is posed here.
 *
 * Pair with `actPaddleHit` for the same `side`.
 */
export async function arrangePaddleHit(
  api,
  side,
  { cy = 360, vy = 0, ballY = 360, approachSpeed = 400, startX } = {},
) {
  const other = side === "left" ? "right" : "left";
  await api.call("setPaddle", side, { cy, vy });
  await api.call("setPaddle", other, { cy: 150, vy: 0 });
  const x = startX ?? (side === "left" ? 85 : FIELD_W - 85);
  const vx = side === "left" ? -approachSpeed : approachSpeed;
  await api.call("setBall", 0, { x, y: ballY, vx, vy: 0, spin: 0 });
}

/**
 * ACT half of a paddle contact on `side`: run the real simulation until the ball
 * bounces off that paddle's front face (its horizontal velocity reverses toward the
 * far goal) and return the ball's state the instant it rebounds — before spin decays
 * or curves the flight. Polls one tick at a time because the exact instant of the
 * bounce is what is read.
 *
 * Pair with `arrangePaddleHit` for the same `side`. Returns `{ ball, paddle, hit }`,
 * where `paddle` is the struck paddle.
 */
export async function actPaddleHit(api, side, { max = 72, poll = TICK } = {}) {
  // 72 ticks = the old 0.6s cap.
  const rebounded =
    side === "left" ? (s) => s.balls[0].vx > 0 : (s) => s.balls[0].vx < 0;
  const r = await api.until(rebounded, { max, poll });
  return { ball: r.snap.balls[0], paddle: r.snap.paddles[side], hit: r.hit };
}

/** ARRANGE half of a LEFT-paddle contact. Thin alias of `arrangePaddleHit`. */
export function arrangeLeftPaddleHit(api, opts) {
  return arrangePaddleHit(api, "left", opts);
}

/** ACT half of a LEFT-paddle contact. Thin alias of `actPaddleHit`. */
export function actLeftPaddleHit(api, opts) {
  return actPaddleHit(api, "left", opts);
}

// ---- Rally speed -----------------------------------------------------------

/**
 * ARRANGE half of the straight rally: two stationary, centered paddles and a ball
 * launched level down the middle. A center hit returns the ball level, so it bounces
 * cleanly back and forth clear of the obstacles.
 *
 * Pair with `actRallySpeeds`.
 */
export async function arrangeRally(api) {
  await startPlaying(api);
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: 360, vx: -500, vy: 0, spin: 0 });
}

/**
 * ACT half of the straight rally: play a REAL rally and return the ball's speed after
 * each successive real paddle hit. Speed is constant between hits, so each leg sweeps
 * coarsely until vx reverses (a hit). The two rally checks — that a hit accelerates
 * the ball, and that the speed-up caps at a ceiling — share this drive so they read
 * the same real rally. Stops early if play ever leaves the field.
 *
 * Pair with `arrangeRally`. Returns an array of speeds, one per hit.
 */
export async function actRallySpeeds(api, hits = 24) {
  const speeds = [];
  let prevSign = -1; // ball starts moving left, toward the left paddle
  for (let hit = 0; hit < hits; hit += 1) {
    const snap = await api.snapshot();
    if (Math.sign(snap.balls[0].vx) !== prevSign) {
      prevSign = Math.sign(snap.balls[0].vx);
    }
    const want = -prevSign; // the sign vx takes once this leg's paddle hit lands
    let leftPlay = false;
    // 600 ticks = the old 100 x 0.05s inner cap; poll 6 = the old 0.05s chunk.
    const r = await api.until(
      (s) => {
        if (s.screen !== "playing") {
          leftPlay = true;
          return true;
        }
        const { vx } = s.balls[0];
        return Math.sign(vx) === want && vx !== 0;
      },
      { max: 600, poll: 6 },
    );
    if (leftPlay || !r.hit) break;
    speeds.push(r.snap.balls[0].speed);
    prevSign = want;
  }
  return speeds;
}

// ---- Input-driven helpers --------------------------------------------------
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
 *
 * Menu navigation is instant (single key presses), so this is arrange-callable on its
 * own — it is the ARRANGE half of both the movement and the pause scenarios.
 */
export async function startWithKeys(api, mode) {
  await api.reset();
  if (mode === "versus") await api.call("press", "ArrowDown"); // SOLO -> VERSUS
  await api.call("press", "Enter"); // confirm the highlighted entry
}

/** ARRANGE half of a movement-key check. Alias of `startWithKeys`; pair with `actHoldMove`. */
export const arrangeMove = startWithKeys;

/**
 * ACT half of a movement-key check: hold a movement key and report how the paddles'
 * center y moved. `side` is the paddle under test ("left" or "right"). The verdict is
 * read after exactly `ticks` of held input, so the measured displacement is the same
 * in both passes; the extra `tailTicks` are held afterwards purely so the recorded
 * clip shows the paddle sliding for a readable moment before the key is released
 * (they cannot affect the returned deltas, which were already captured).
 *
 * Pair with `arrangeMove`. Returns `{ start, end, delta, otherDelta }` for `side`
 * (delta < 0 is upward, > 0 downward), plus `otherDelta` — how far EACH paddle moved —
 * so a caller can also confirm a key left the paddle it must not touch still.
 */
export async function actHoldMove(
  api,
  side,
  code,
  { ticks = 36, tailTicks = 78 } = {},
) {
  const before = (await api.snapshot()).paddles;
  await api.call("keyDown", code);
  await api.advance(ticks); // 36 ticks = the old 0.3s of measured motion
  const after = (await api.snapshot()).paddles;
  await api.advance(tailTicks); // 78 ticks = the old 650ms visible hold
  await api.call("keyUp", code);
  const moved = (s) => after[s].cy - before[s].cy;
  return {
    start: before[side].cy,
    end: after[side].cy,
    delta: moved(side),
    otherDelta: { left: moved("left"), right: moved("right") },
  };
}

/** ARRANGE half of a pause-key check. Alias of `startWithKeys`; pair with `actPause`. */
export const arrangePause = startWithKeys;

/**
 * ACT half of a pause-key check: let the match play visibly for a moment, press a
 * pause key (`Esc` / `KeyP`), then hold on the result. The old helper split this into
 * an instant settle plus a real-time clip tail; `act` IS the clip now, so it is one
 * timed run — the pause verdict never depended on the timing.
 *
 * Pair with `arrangePause`. Returns the screen after the press.
 */
export async function actPause(
  api,
  code,
  { playTicks = 72, holdTicks = 84 } = {},
) {
  await api.advance(playTicks); // 72 ticks = the old 0.2s settle + 400ms of visible play
  await api.call("press", code);
  await api.advance(holdTicks); // 84 ticks = the old 700ms hold on the pause menu
  return (await api.snapshot()).screen;
}

/** ARRANGE half of the mute check: sit at the title, where mute starts off. Pair with `actMuteToggle`. */
export async function arrangeTitle(api) {
  await api.reset();
}

/**
 * ACT half of the mute check: from the title (mute off) press the mute key, read the
 * flag either side of the press, then let the title redraw and capture it so the
 * changed mute hint is visible as proof. Pass `shot: null` to skip the capture.
 *
 * Pair with `arrangeTitle`. Returns `{ before, after }`.
 */
export async function actMuteToggle(
  api,
  { code = "KeyM", settleTicks = 24, shot = "mute" } = {},
) {
  const before = (await api.snapshot()).muted;
  await api.call("press", code);
  const after = (await api.snapshot()).muted;
  await api.advance(settleTicks); // 24 ticks = the old 200ms title redraw
  if (shot) await api.screenshot(shot);
  return { before, after };
}

// ---- Controls assertions (record into the item's `check`) ------------------
//
// Every controls sub-item makes the same one-fact check — a movement key moves a
// paddle, a pause key pauses, the mute key toggles mute — so these three wrappers
// each record the assertion(s) for one scenario into the item's `check` (from
// `ttc.checkOne(id)`). They take the outcome the matching `actX` returned rather than
// driving anything themselves, so they are `assert`-phase only. Keeping the shape
// here means every controls item asserts in one line and they can never drift. Each
// uses a comparison matcher, so a failing check shows the observed
// displacement/screen/flag against what it required.

const MOVE_MIN = 40; // a clearly non-trivial paddle displacement, in logical px
export const STILL_MAX = 6; // a paddle a key must NOT touch should barely budge, in px

/**
 * Assert a movement-key control result: `r` is what `actHoldMove` returned. Confirms
 * the paddle moved the expected way (`up` true = center y decreases). `who` names the
 * paddle for the assertion. When `isolate` is given (the id of the OTHER paddle, only
 * meaningful in Versus, where both paddles are human-driven with no AI), a second
 * assertion confirms that paddle stays still — catching the common bug where a Versus
 * key drives both paddles (e.g. Up/Down moving player one's paddle as well as player
 * two's). Records into `check`.
 */
export function assertMove(check, r, { code, up, who, isolate }) {
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
 * Assert a pause-key control result: `screen` is what `actPause` returned, and the
 * game must have gone to the pause screen. Records into `check`.
 */
export function assertPause(check, screen, { code }) {
  check.expectEq(
    `pressing ${code} during play pauses the match`,
    screen,
    "paused",
  );
}

/**
 * Assert the mute-toggle control result: `{ before, after }` is what `actMuteToggle`
 * returned — mute is off at the title and a single mute-key press flips it on (the
 * title capture `actMuteToggle` took is the visual proof). Records into `check`.
 */
export function assertMute(check, { before, after }, { code = "KeyM" } = {}) {
  check.expectEq("mute starts off at the title", before, false);
  check.expectEq(`pressing ${code} toggles mute on`, after, true);
}

// ---- Serve direction (base + gyre) ----------------------------------------
//
// Serve direction is checked as three separate points, so a build fails exactly the
// rule it breaks: the very first serve of a match, and the serve after a point is
// scored on each player. base and gyre both serve toward the receiver, so both
// drive these same shared helpers (multi launches at random angles and has no such
// point).

/** ARRANGE half of the first-serve check: start a fresh match and serve. Pair with `actFirstServeVx`. */
export async function arrangeFirstServe(api) {
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
}

/**
 * ACT half of the first-serve check: read the horizontal velocity of the serve, then
 * let the ball travel so the recorded clip shows which way it went. vx is captured
 * before the ball moves, so the trailing travel cannot change the value asserted.
 *
 * Pair with `arrangeFirstServe`. Returns the serve's vx.
 */
export async function actFirstServeVx(api, { ticks = 90 } = {}) {
  const { vx } = (await api.snapshot()).balls[0];
  await api.advance(ticks); // 90 ticks (0.75s) of visible flight for the clip
  return vx;
}

/**
 * ARRANGE half of the serve-after-a-point check: a live match with a real point aimed
 * out one goal `edge` — "left" (player two scores, so player one was scored on) or
 * "right" (player one scores, so player two was scored on).
 *
 * Pair with `actServeAfterGoalVx`.
 */
export async function arrangeServeAfterGoal(api, edge) {
  await startPlaying(api);
  await arrangeGoal(api, edge);
}

/**
 * ACT half of the serve-after-a-point check: play the posed point out through the real
 * scoring code, serve the next ball, and return that serve's horizontal velocity — it
 * should travel toward whichever player was just scored on (the receiver). The served
 * ball is then left to fly for a moment so the clip shows its direction; vx is captured
 * first, so that cannot change the value asserted.
 *
 * Pair with `arrangeServeAfterGoal`. Returns the next serve's vx.
 */
export async function actServeAfterGoalVx(api, { ticks = 90 } = {}) {
  await actGoal(api);
  await api.call("serve");
  const { vx } = (await api.snapshot()).balls[0];
  await api.advance(ticks); // 90 ticks (0.75s) of visible flight for the clip
  return vx;
}

// ---- Match over ------------------------------------------------------------

/**
 * ARRANGE half of the match-over drive: a live match with the score set to 10-0 and a
 * real point aimed across the right goal, so player one reaches 11-0 and the win rule
 * resolves through the real scoring code rather than a fabricated end state.
 *
 * Pair with `actMatchOver`.
 */
export async function arrangeMatchOver(api, mode = "versus") {
  await startPlaying(api, mode);
  await api.call("setScore", 10, 0);
  await arrangeGoal(api, "right");
}

/**
 * ACT half of the match-over drive: play the winning point and return the snapshot the
 * instant the match-over screen appears.
 *
 * Pair with `arrangeMatchOver`. Returns the snapshot.
 */
export async function actMatchOver(api) {
  return actGoal(api);
}

// ---- Beatable AI (Solo) ----------------------------------------------------
//
// The three AI checks all pit the REAL computer opponent against a posed approach,
// in Solo, and read whether it blocks the shot or the shot gets past it. Each starts
// a real Solo match, parks the human (left) paddle and any extra balls clear of the
// lane, poses ball 0's approach and the AI paddle's start, then — crucially — calls
// `setAiControl(true)` so the AI itself drives its (right) paddle as the real physics
// runs (a control op alone freezes the AI; see specs/instrumentation.md). Nothing
// fabricates the outcome: the AI's own tracking, at its own speed, decides whether it
// reaches the ball.
//
// There is no longer a separate "clip" variant of this drive: `act` IS the clip, so
// the same `actAiScenario` that decides the outcome in the validate pass is what the
// record pass films the AI tracking the shot in real time.

/**
 * ARRANGE half of a Solo AI scenario: a live Solo match with the human paddle parked
 * out of the lane, any extra balls neutralized, ball 0 aimed by `ball` ({x, y, vx,
 * vy?}), the AI (right) paddle started at `paddleCy`, and the AI handed control of its
 * paddle. After this, running time forward pits the real AI against the shot.
 *
 * Pair with `actAiScenario`.
 */
export async function arrangeAiScenario(api, { paddleCy, ball }) {
  await api.reset();
  await api.call("startMatch", "solo");
  await api.call("serve"); // leave the pre-serve countdown for live play
  await neutralizeExtraBalls(api);
  // Park the human paddle above the lane so it never intercepts a rebound before the
  // AI's own result is read.
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: paddleCy, vy: 0 });
  await api.call("setBall", 0, { vy: 0, spin: 0, ...ball });
  await api.call("setAiControl", true);
}

/**
 * ACT half of a Solo AI scenario: run the real simulation until the shot resolves and
 * report the outcome. Polls finely (2 ticks) because the resolution is read off a sign
 * change in the ball's vx, which a coarse sweep could step straight past.
 *
 * Pair with `arrangeAiScenario`. Returns `{ result, snap }` where `result` is:
 *   - "blocked" — the AI reached the ball: it rebounded off the right paddle (vx
 *     turned negative) before crossing the goal.
 *   - "scored"  — the shot got past the AI: player one's score went up (ball 0 left
 *     the right goal).
 *   - "timeout" — neither happened within `max` ticks.
 */
export async function actAiScenario(api, { max = 480, poll = 2 } = {}) {
  // 480 ticks = the old 4s cap; poll 2 ≈ the old 0.02s sampling chunk.
  const start = (await api.snapshot()).score.p1;
  let sawIncoming = false;
  let result = "timeout";
  const r = await api.until(
    (s) => {
      const b = s.balls[0];
      // The ball must be seen travelling toward the AI before a leftward vx can mean
      // the AI hit it, otherwise the posed approach itself would read as a block.
      if (b.vx > 0) sawIncoming = true;
      if (s.score.p1 > start) {
        result = "scored";
        return true;
      }
      if (sawIncoming && b.vx < 0 && b.x < FIELD_W) {
        result = "blocked";
        return true;
      }
      return false;
    },
    { max, poll },
  );
  return { result, snap: r.snap };
}

// ---- Color sampling (reads the rendered canvas, not a reported value) -------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas (see
// packages/browser-driver/driver.mjs), so a logical field coordinate maps to a
// fraction by dividing by the field size and an item never has to know the canvas's
// pixel dimensions. Reading the rendered pixel (rather than a color the game merely
// reports) means a build cannot pass by returning a value it does not draw.

// On-field sample points (logical px), valid on the posed color scene below: the
// paddles centered at cy 360, obstacle A at its fixed base center, and a patch of
// empty field for the background. Obstacle A sits at this base center in every
// variant when the field is posed upright.
export const COLOR_POINTS = {
  leftPaddle: { x: 56, y: 360 },
  rightPaddle: { x: 1224, y: 360 },
  obstacle: { x: 490, y: 220 },
  // Ball 0 is posed here — a clean mid-field spot clear of the paddles, the two
  // obstacles, and the center net at x=640 — so the ball's own color reads solid.
  ball: { x: 300, y: 360 },
  background: { x: 500, y: 650 },
};

/**
 * Average the rendered color over a small 5-point cluster (center + four neighbors a
 * few px out) that stays inside the element's solid fill, so a stray antialiased or
 * glow pixel at an edge cannot swing the reading. Returns `{ r, g, b }` (0–255).
 *
 * A pure read of the canvas: it consumes no simulation time, but it must run in `act`
 * because it needs the posed scene to have painted.
 */
export async function sampleColor(api, x, y) {
  const offsets = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const p = await api.pixel((x + dx) / FIELD_W, (y + dy) / FIELD_H);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = offsets.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** Euclidean distance between two RGB colors (0 to ~441). */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * ARRANGE half of the color checks: pose a clean scene — a live match with both
 * paddles centered at cy 360, ball 0 at the mid-field ball sample point, and any
 * extra balls of a multi build parked in the corners clear of every sample point, so
 * the left paddle, right paddle, obstacle, ball, and an empty patch of field each
 * render an unobstructed, solid color. A match opens with the obstacles upright at
 * their base centers (held there while driven, including in the gyre variant), so
 * obstacle A is at its known center in every variant.
 *
 * Pair with `actColorSamples`.
 */
export async function arrangeColorScene(api) {
  await api.reset();
  await api.call("startMatch", "versus");
  await api.call("serve");
  await api.call("setPaddle", "left", { cy: 360, vy: 0 });
  await api.call("setPaddle", "right", { cy: 360, vy: 0 });
  const { balls } = await api.snapshot();
  const corners = [
    { x: 40, y: 690 },
    { x: 1240, y: 690 },
    { x: 40, y: 40 },
  ];
  for (let i = 0; i < balls.length; i += 1) {
    // Ball 0 sits at the mid-field ball sample point so its own color can be read;
    // extra balls (multi) go in the corners, clear of every sample point.
    const spot =
      i === 0 ? COLOR_POINTS.ball : corners[(i - 1) % corners.length];
    await api.call("setBall", i, {
      x: spot.x,
      y: spot.y,
      vx: 0,
      vy: 0,
      spin: 0,
    });
  }
}

/**
 * ACT half of the color checks: let a frame paint so the sampled pixels reflect the
 * posed scene, then read every point in `COLOR_POINTS`. The scene is static, so the
 * settle only has to cover a repaint — not any simulation.
 *
 * Pair with `arrangeColorScene`. Returns `{ leftPaddle, rightPaddle, obstacle,
 * background }`, each an `{ r, g, b }` from `sampleColor`.
 */
export async function actColorSamples(api, { settleMs = 80 } = {}) {
  // A REAL pause, not `advance`. These checks read the pixels the build actually
  // painted, which needs a frame to have landed since the scene was posed — and in
  // the validate pass `advance` is instant, so it produces no frame at all. Waiting
  // on driver round trips instead would make the sample a race that fails a build
  // which painted the scene correctly. See `api.settle` in validation.mjs.
  await api.settle(settleMs);
  const out = {};
  for (const [name, p] of Object.entries(COLOR_POINTS)) {
    out[name] = await sampleColor(api, p.x, p.y);
  }
  return out;
}

// ---- Serve speed -----------------------------------------------------------
//
// The ball leaves every serve at the base serve speed (balls-standard.md: "serves
// at the 520 px/s serve speed"). The serve is set up with `arrangeFirstServe`; this
// reads the speed the ball actually launched at.

export const SERVE_SPEED = 520; // px/s (balls-standard.md)

/**
 * ACT half of the serve-speed check: read the ball's speed the instant it is served,
 * then let it fly so the clip shows it travelling. Speed is captured before the ball
 * moves, so the trailing flight cannot change the value asserted.
 *
 * Pair with `arrangeFirstServe`. Returns the served ball's speed.
 */
export async function actServeSpeed(api, { ticks = 90 } = {}) {
  const { speed } = (await api.snapshot()).balls[0];
  await api.advance(ticks); // 90 ticks (0.75s) of visible flight for the clip
  return speed;
}

// ---- Countdown length ------------------------------------------------------
//
// The pre-serve hold lasts a fixed 1.0 s (balls-standard.md: "holds there for a
// 1.0 s countdown"), which at 120 Hz is exactly 120 ticks before the ball serves.

export const HOLD_TICKS = 120; // 1.0 s pre-serve hold at 120 Hz

/** ARRANGE half of the countdown-length check: start a match, opening on the hold. */
export async function arrangeCountdown(api, mode = "versus") {
  await api.reset();
  await api.call("startMatch", mode); // opens on the pre-serve countdown, ball held
}

/**
 * ACT half of the countdown-length check: step one tick at a time until the ball
 * serves (the screen leaves the countdown for live play) and report how many ticks
 * the hold lasted. The initial held snapshot is returned too, so the check can
 * confirm the ball waits before it counts the hold.
 *
 * Pair with `arrangeCountdown`. Returns `{ start, ticks, served, snap }`.
 */
export async function actCountdownTicks(api, { max = 240 } = {}) {
  const start = await api.snapshot();
  const r = await api.until((s) => s.screen === "playing", { max, poll: TICK });
  return { start, ticks: r.spent, served: r.hit, snap: r.snap };
}

// ---- Paddle movement speed -------------------------------------------------
//
// The human paddle moves at a fixed 720 px/s while a movement key is held
// (modes.md), and the AI paddle chases at its own slower speed (560 px/s, modes.md,
// tunable but deliberately slower so it stays beatable). A held-key move is measured
// with `actHoldMove`; the AI chase is driven through the real opponent
// (`arrangeAiChase`/`actAiChaseSpeed`).

export const PADDLE_SPEED = 720; // px/s while a movement key is held (modes.md)
export const AI_SPEED = 560; // the AI paddle's max chase speed (modes.md)
const HUMAN_SPEED_TOL = 0.2; // ±20% of the spec paddle speed
const AI_SPEED_FLOOR = 250; // the AI must chase at a competent, non-trivial rate

/** Speed in px/s from a `delta` (Δcy) measured over `ticks` fixed steps. */
export function speedFromDelta(delta, ticks) {
  return (Math.abs(delta) * TICK_HZ) / ticks;
}

/**
 * Assert a human paddle's movement speed: `moved` is what `actHoldMove` returned and
 * `ticks` is the span it measured over (its default 36). Confirms the paddle moved at
 * about the 720 px/s spec speed. Records into `check`.
 */
export function assertHumanSpeed(check, moved, { code, who, ticks = 36 } = {}) {
  check.expectClose(
    `holding ${code} moves ${who} at about the 720 px/s paddle speed (px/s)`,
    speedFromDelta(moved.delta, ticks),
    PADDLE_SPEED,
    PADDLE_SPEED * HUMAN_SPEED_TOL,
  );
}

/**
 * ARRANGE half of the AI chase-speed / paddle-freeze scenarios: a live Solo match with
 * the human paddle parked out of the lane, the AI (right) paddle started at
 * `paddleCy`, a ball placed far in y from it and moving toward it (so the AI tracks
 * the ball down the field), and the AI handed control of its paddle. From here running
 * time forward makes the real AI chase the ball at its own speed.
 *
 * Pair with `actAiChaseSpeed`.
 */
export async function arrangeAiChase(
  api,
  { paddleCy = 120, ballY = 650 } = {},
) {
  await api.reset();
  await api.call("startMatch", "solo");
  await api.call("serve");
  await neutralizeExtraBalls(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 }); // park the human paddle
  await api.call("setPaddle", "right", { cy: paddleCy, vy: 0 });
  await api.call("setBall", 0, { x: 640, y: ballY, vx: 200, vy: 0, spin: 0 });
  await api.call("setAiControl", true);
}

/**
 * ACT half of the AI chase-speed check: measure how far the AI paddle travels over a
 * short window while it is chasing the ball at full speed, and convert to px/s. A
 * further tail lets the chase play on for a readable clip (it cannot affect the
 * measured speed, already captured).
 *
 * Pair with `arrangeAiChase`. Returns `{ speed, delta }`.
 */
export async function actAiChaseSpeed(
  api,
  { ticks = 12, tailTicks = 60 } = {},
) {
  const before = (await api.snapshot()).paddles.right.cy;
  await api.advance(ticks);
  const after = (await api.snapshot()).paddles.right.cy;
  await api.advance(tailTicks);
  return {
    speed: speedFromDelta(after - before, ticks),
    delta: after - before,
  };
}

/**
 * Assert the AI paddle's chase speed: it must chase at a competent, non-trivial rate,
 * yet stay slower than the human's 720 px/s so it remains beatable (modes.md). Records
 * into `check`.
 */
export function assertAiSpeed(check, { speed }) {
  check.expectGt(
    "the AI paddle chases the ball at a competent, non-trivial rate (px/s)",
    speed,
    AI_SPEED_FLOOR,
  );
  check.expectLt(
    "the AI paddle is slower than the human's 720 px/s, so it stays beatable (px/s)",
    speed,
    PADDLE_SPEED,
  );
}

/**
 * ARRANGE half of the AI moving-hit spin check: a live Solo match with the human
 * paddle parked, the AI (right) paddle started above the mid lane, a ball aimed to
 * arrive at the AI paddle's front face while the AI is still sweeping down through the
 * lane, and the AI handed control. So the AI strikes the ball while its paddle is
 * moving, imparting spin from that motion.
 *
 * Pair with `actPaddleHit(api, "right")`.
 */
export async function arrangeAiMovingHit(api) {
  await api.reset();
  await api.call("startMatch", "solo");
  await api.call("serve");
  await neutralizeExtraBalls(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 }); // park the human paddle
  await api.call("setPaddle", "right", { cy: 180, vy: 0 }); // AI starts above the lane
  await api.call("setBall", 0, { x: 1072, y: 360, vx: 500, vy: 0, spin: 0 });
  await api.call("setAiControl", true);
}

// ---- Pause: paddles and the ball must freeze -------------------------------
//
// While the game is paused nothing advances: neither a held movement key nor the AI
// moves a paddle, and a ball in flight hangs where it was. On resume the ball carries
// on from exactly where it stopped rather than being teleported. These helpers drive
// those checks. STILL_MAX (above) is the "did not move" threshold.

/**
 * ACT half of a paused-paddle (human) check: pause from the countdown, then hold a
 * movement key. While paused the paddle must not move. A short tail holds on the
 * paused menu for the clip. Returns `{ screen, delta }` — the paused screen and the
 * paddle's Δcy over the held span (which must be ~0).
 *
 * Pair with `startWithKeys` as the arrange half.
 */
export async function actPausedHold(
  api,
  side,
  code,
  { holdTicks = 96, tailTicks = 24 } = {},
) {
  await api.call("press", "Escape");
  const screen = (await api.snapshot()).screen;
  const before = (await api.snapshot()).paddles[side].cy;
  await api.call("keyDown", code);
  await api.advance(holdTicks);
  const after = (await api.snapshot()).paddles[side].cy;
  await api.advance(tailTicks);
  await api.call("keyUp", code);
  return { screen, delta: after - before };
}

/**
 * ARRANGE half of the paused-AI-paddle check: a live Solo match with the AI paddle
 * posed off-center and a ball placed so the AI would chase it, then handed to the AI.
 * Pausing (in the act half) must freeze that chase.
 *
 * Pair with `actAiPaused`.
 */
export async function arrangeAiPaused(api) {
  await api.reset();
  await api.call("startMatch", "solo");
  await api.call("serve");
  await neutralizeExtraBalls(api);
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 200, vy: 0 });
  await api.call("setBall", 0, { x: 900, y: 620, vx: 500, vy: 0, spin: 0 });
  await api.call("setAiControl", true);
}

/**
 * ACT half of the paused-AI-paddle check: pause the match, then let time pass. While
 * paused the AI paddle must not move even though the posed ball gives it something to
 * chase. Returns `{ screen, delta }` — the paused screen and the AI paddle's Δcy.
 *
 * Pair with `arrangeAiPaused`.
 */
export async function actAiPaused(
  api,
  { pausedTicks = 120, tailTicks = 24 } = {},
) {
  await api.call("press", "Escape");
  const screen = (await api.snapshot()).screen;
  const before = (await api.snapshot()).paddles.right.cy;
  await api.advance(pausedTicks);
  const after = (await api.snapshot()).paddles.right.cy;
  await api.advance(tailTicks);
  return { screen, delta: after - before };
}

/**
 * ARRANGE half of the pause-suspends / pause-continues ball checks: a live match with
 * the ball posed in mid-flight (`ball` = {x, y, vx, vy}), clear of the obstacles so a
 * short flight is a straight line. Spin is zeroed so the path is predictable.
 *
 * Pair with `actBallSuspended` or `actBallContinues`.
 */
export async function arrangeLiveBall(api, ball, mode = "versus") {
  await startPlaying(api, mode);
  await clearPaddles(api);
  await api.call("setBall", 0, { spin: 0, vy: 0, ...ball });
}

// ---- Obstacle bank shots (per face) ----------------------------------------
//
// The ball reflects off each mid-field obstacle's left and right face, so a bank
// shot works from either side. Each obstacle is a thin vertical bar; a shot fired
// level with it, straight at one face, reflects back the way it came and stays on the
// near side of that face. Speed is preserved (only paddles multiply it).

export const OBSTACLE_A = { x0: 480, x1: 500, y: 220 }; // A — center (490, 220)
export const OBSTACLE_B = { x0: 780, x1: 800, y: 500 }; // B — center (790, 500)
const OBSTACLE_SPEED = 600;

/**
 * ARRANGE half of an obstacle bank shot: line the ball up 180 px short of `faceX`,
 * level with the obstacle at `y`, travelling straight at that face. `from` is the
 * side the ball approaches from — "left" (moving right into the left face) or "right"
 * (moving left into the right face). Control ops only, so it is callable from either
 * phase.
 *
 * Pair with `actObstacleBounce` for the same `from`.
 */
export async function arrangeObstacleBounce(api, { faceX, y, from }) {
  await clearPaddles(api);
  await neutralizeExtraBalls(api);
  const x = from === "left" ? faceX - 180 : faceX + 180;
  const vx = from === "left" ? OBSTACLE_SPEED : -OBSTACLE_SPEED;
  await api.call("setBall", 0, { x, y, vx, vy: 0, spin: 0 });
}

/**
 * ACT half of an obstacle bank shot: run the real collision code until the ball
 * reflects off the struck face (its horizontal velocity reverses). Polls one tick at
 * a time because the near-side check reads the instant of the rebound.
 *
 * Pair with `arrangeObstacleBounce` for the same `from`. Returns `{ snap, hit }`.
 */
export async function actObstacleBounce(
  api,
  from,
  { max = 240, poll = TICK } = {},
) {
  const reversed =
    from === "left" ? (s) => s.balls[0].vx < 0 : (s) => s.balls[0].vx > 0;
  const r = await api.until(reversed, { max, poll });
  return { snap: r.snap, hit: r.hit };
}

// ---- Debug API surface -----------------------------------------------------
//
// The operations every build must install on the debug handle
// (specs/instrumentation.md). The sanity check confirms each is present as a function
// (read through the driver's `api.probe`, which reflects typeof without invoking
// them). The gyre-only `setObstacleClock` is exercised by the gyre checks, so it is
// not in this common list.

export const REQUIRED_DEBUG_OPS = [
  "reset",
  "step",
  "setAutoStep",
  "snapshot",
  "startMatch",
  "serve",
  "setScore",
  "setPaddle",
  "setBall",
  "setAiControl",
  "keyDown",
  "keyUp",
  "press",
];

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// The game must not autoplay: it creates its AudioContext only on the first user
// interaction (flow.md). So before driving an event whose cue is checked, inject one
// neutral key press to arm audio. A key with no game binding leaves state untouched
// while still counting as the first interaction. From there the driver's `api.audio`
// reports every Web Audio source the build starts, so a cue is confirmed by the log
// growing across the event.

/** Arm the build's audio with a single neutral first key press. */
export async function armAudio(api) {
  await api.call("press", "KeyZ");
}
