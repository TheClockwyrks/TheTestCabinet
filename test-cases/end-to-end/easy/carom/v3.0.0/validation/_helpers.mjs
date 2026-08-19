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
// ENGINES. A run selects an engine independently of the case (`engines` in
// test-case.toml: `none`, or `simple-2d`), and under an engine several of the
// surfaces these helpers drive stop being the build's and become the engine's — the
// frame clock, the keyboard, the debug overlay, and the audio bus. Every one of
// those differences is absorbed HERE, behind one helper each, so a calling item is
// written once and reads the same either way. The tick units above are unaffected:
// the engine host's manual clock steps at the case's `tick_hz` by default, so one
// unit of `advance` is still one tick whichever runtime is underneath. See "The
// engine host" below.
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

// Read ball 0's state from a snapshot, whatever the variant reports: a single-ball
// build (base, gyre) exposes one `ball` object; the multi build exposes a `balls`
// array (specs/instrumentation.md). Every shared helper reads ball 0 through this so
// the same driver works across both shapes.
export function ball0(snap) {
  return snap.balls ? snap.balls[0] : snap.ball;
}

// ---- The engine host -------------------------------------------------------
//
// Under `none` the build supplies the whole instrumentation surface itself, and
// every helper below drives `window.__carom`. Under `simple-2d` the frame clock, the
// input actions, the debug overlay and the audio bus belong to the ENGINE, which
// installs a host interface of its own on `window.__tcabEngine`
// (components/core/engines.md). `window.__carom` then carries only what is still
// Carom's — `reset`, `snapshot`, and the control ops that pose a scenario in the
// game's own world — because those are the only parts that are about *this game*.
//
// WHY THE ENGINE IS DETECTED RATHER THAN CONFIGURED. Nothing tells a validation
// script which engine its run selected, and nothing should. The engine is a run
// dimension, one script file serves both, and a case that had to be told would be
// keeping a second copy of a fact the run already knows — free to drift, and wrong
// in exactly the situation that matters most: a build that failed to create the
// engine at all would still be driven as though it had one. The driver is already
// looking at the page, so the page is asked. A build with the host handle installed
// IS an engine run, by definition: `createEngine` installs it, so no build can omit
// it, and no build without an engine can fake it.

/** The `window` property the engine installs its host interface on. */
export const ENGINE_HANDLE = "__tcabEngine";

/**
 * The debug-API operations the ENGINE provides once one is selected, and which
 * `window.__carom` therefore stops carrying (specs/instrumentation.md): the manual
 * clock, and keyboard injection.
 */
export const ENGINE_PROVIDED_DEBUG_OPS = [
  "step",
  "setAutoStep",
  "keyDown",
  "keyUp",
  "press",
];

// One answer per `api`. An item asks on nearly every keystroke, and each pass builds
// its own `api` object, so a cache keyed on it is both cheap and incapable of
// leaking the validate pass's answer into the record pass's page.
const ENGINE_HOST_BY_API = new WeakMap();

/**
 * Whether an engine host is installed on this build, and at what interface version:
 * `{ present, version }`. Returns a promise; safe to await from any phase, since it
 * only reads.
 *
 * `version` is the host interface's own version when it could be read, and `null`
 * when presence had to be inferred without reading it (see `detectEngineHost`), so a
 * caller that needs a particular version can tell "version 1" from "not known".
 */
export function engineHost(api) {
  let pending = ENGINE_HOST_BY_API.get(api);
  if (!pending) {
    pending = detectEngineHost(api);
    ENGINE_HOST_BY_API.set(api, pending);
  }
  return pending;
}

/** Ask the page, once, whether the engine host is there. */
async function detectEngineHost(api) {
  if (typeof api.evaluate === "function") {
    const seen = await api.evaluate(
      `(() => {\n` +
        `  const host = window[${JSON.stringify(ENGINE_HANDLE)}];\n` +
        `  if (!host) return { present: false, version: null };\n` +
        `  return { present: true, version: typeof host.version === "number" ? host.version : null };\n` +
        `})()`,
    );
    return { present: seen?.present === true, version: seen?.version ?? null };
  }
  // No generic evaluation path on this driver, so the handle cannot be READ — but it
  // can still be inferred from the shape of the case handle, and inferring beats
  // assuming `none`. Under an engine the build installs none of the five ops above
  // (specs/instrumentation.md strikes all five), and under `none` every one of them
  // is mandatory, so "not one of the five is a function" is an engine run. A `none`
  // run then drives exactly the path it has always driven, and an engine run fails
  // in `hostCall` naming the driver operation it needs, rather than by calling a
  // `keyDown` that was never there.
  const { ops } = await api.probe(ENGINE_PROVIDED_DEBUG_OPS);
  const present = ENGINE_PROVIDED_DEBUG_OPS.every(
    (op) => ops?.[op] !== "function",
  );
  return { present, version: null };
}

/**
 * Call one operation on the engine host and return what it returned.
 *
 * The rest of the driver `api` is bound to the CASE handle — `api.call` invokes
 * `window.__carom.<op>` and `api.probe` reflects its shape — which is right for a
 * model-written surface and useless for reaching an engine's, since an engine
 * installs itself on a handle of its own. The driver's generic page evaluation is
 * the one operation that is not so bound, so it is where every engine-side read and
 * call goes, and this is the only place in the case that uses it.
 */
export async function hostCall(api, method, ...args) {
  if (typeof api.evaluate !== "function") {
    throw new Error(
      `the ${ENGINE_HANDLE} engine host is installed, but this driver exposes no ` +
        `generic page evaluation (api.evaluate), so ${method}() cannot be reached — ` +
        `see packages/browser-driver/driver.mjs`,
    );
  }
  const call = `window[${JSON.stringify(ENGINE_HANDLE)}].${method}(${args
    .map((arg) => JSON.stringify(arg))
    .join(", ")})`;
  // `undefined` does not survive the trip back out of the page, so a void operation
  // (`setSchedule`, `setAction`) is normalized to null and resolves rather than
  // reading as a failed evaluation.
  return api.evaluate(
    `(() => { const result = ${call}; return result === undefined ? null : result; })()`,
  );
}

// ---- State-only helpers (arrange) ------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/** Park both paddles out of the mid-field lane (cy 150) so a shot down y=360 is unobstructed. */
export async function clearPaddles(api) {
  await api.call("setPaddle", "left", { cy: 150, vy: 0 });
  await api.call("setPaddle", "right", { cy: 150, vy: 0 });
}

/**
 * Pin the obstacles UPRIGHT at their base centers for a common (non-gyre-specific)
 * scenario. In the gyre variant the obstacles sway and rotate, so NO mid-field lane
 * stays clear and NO obstacle face stays axis-aligned — the y=360 "clear" lane the
 * rally and goal drives ride is swept by both obstacles at the extremes of their sway
 * (A reaches y≈300+70 and B reaches y≈420−70, both into y=360), and a bank shot fired
 * at an obstacle's base-x face meets a tilted, shifted rectangle instead. A build holds
 * the obstacle clock wherever `setObstacleClock` poses it (specs/instrumentation.md),
 * so posing it to 0 sits obstacle A at (490, 220) and B at (790, 500), upright: the
 * y=360 lane is clear and each face is vertical at its base x. A common item that
 * assumes a still, axis-aligned field (the straight rally, a goal down y=360, a
 * per-face bank shot, a short posed flight) then reads what it intends, rather than
 * whatever pose the field happened to FREEZE at when a control op seized the paddles —
 * which the reference happens to leave upright but the spec never pins there.
 *
 * The gyre-SPECIFIC items (obstacles-sway/spin, oriented-bounce) drive the clock
 * themselves and must NOT call this. Base and multi have no obstacle clock at all, so
 * this probes for the op and is a no-op when it is absent, leaving them unchanged.
 * Control op only — it poses and consumes no time, so it is arrange-callable.
 */
export async function pinObstaclesUpright(api) {
  const { ops } = await api.probe(["setObstacleClock"]);
  if (ops?.setObstacleClock === "function") {
    await api.call("setObstacleClock", 0);
  }
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
  // A single-ball build reports one `ball` and no `balls` array, so there is nothing
  // to park; only the multi build has extras.
  const balls = (await api.snapshot()).balls ?? [];
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
  // In gyre the moving obstacles sweep into the y=360 goal lane; pin them upright so
  // the drive crosses cleanly (a no-op in base/multi and for an already-upright build).
  await pinObstaclesUpright(api);
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
 * The run-up filmed ahead of a driven paddle contact, in ticks.
 *
 * A contact drive poses the ball a few px off the paddle face, so with no lead the
 * bounce lands within a couple of ticks and `act` — which IS the clip — opens on the
 * rebound already in progress. A reviewer then sees only where the ball went, never
 * that it went there BECAUSE it struck the paddle. Half a second of approach makes
 * the contact itself unambiguous, at the cost of nothing: the rebound the assertions
 * read is still the real one the real physics produces, just later in the drive.
 */
export const LEAD_TICKS = 60; // 0.5 s at 120 Hz

/**
 * ARRANGE half of a paddle contact on `side` ("left" or "right"): pose that paddle
 * (`cy`, `vy`) and an incoming ball aimed straight at its front face at height
 * `ballY`. The ball starts just in front of the struck paddle and travels toward it
 * — a left paddle is approached from its right (the ball moving left), a right paddle
 * from its left (moving right) — with the opposite paddle parked out of the lane. The
 * real bounce — angle, speed multiply, and spin from the paddle's actual motion — is
 * what `actPaddleHit` then reads back; nothing about the rebound is posed here.
 *
 * `leadTicks` (see `LEAD_TICKS`) buys the clip a visible approach: the ball starts
 * that much further out, and — because a posed `vy` PERSISTS across steps
 * (specs/instrumentation.md), so a swinging paddle keeps travelling for the whole
 * run-up — the paddle starts the matching distance UPSTREAM, arriving at `cy` as the
 * ball arrives at the face. The contact is therefore the same one the zero-lead pose
 * makes immediately; only the footage in front of it differs.
 *
 * A caller adding lead to a SWINGING paddle must leave it room: the start `cy - vy *
 * lead` has to stay inside the [55, 665] clamp, or the paddle opens pinned against a
 * bound (which zeroes its velocity) instead of sweeping into the ball. Callers that
 * need a long run-up against a still paddle — the bound-pinned contact, which must
 * stay pinned — pass `startX` explicitly and leave `leadTicks` at 0 here, leading the
 * ball alone.
 *
 * Pair with `actPaddleHit` for the same `side`, passing it the same `leadTicks`.
 */
export async function arrangePaddleHit(
  api,
  side,
  {
    cy = 360,
    vy = 0,
    ballY = 360,
    approachSpeed = 400,
    startX,
    leadTicks = 0,
  } = {},
) {
  const other = side === "left" ? "right" : "left";
  const lead = leadTicks / TICK_HZ; // the run-up, in seconds of real flight
  await api.call("setPaddle", side, { cy: cy - vy * lead, vy });
  await api.call("setPaddle", other, { cy: 150, vy: 0 });
  // 85 (and its mirror) is the ball's zero-lead start, a few px off the face; the
  // run-up pushes it back by exactly the distance it covers in `lead`.
  const near = side === "left" ? 85 : FIELD_W - 85;
  const runUp = approachSpeed * lead;
  const x = startX ?? (side === "left" ? near + runUp : near - runUp);
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
 * `leadTicks` is the run-up its arrange half posed, and simply widens the sweep by
 * that much: the cap bounds the CONTACT, not the flight in front of it.
 *
 * Pair with `arrangePaddleHit` for the same `side`. Returns `{ ball, paddle, hit }`,
 * where `paddle` is the struck paddle.
 */
export async function actPaddleHit(
  api,
  side,
  { max = 72, leadTicks = 0, poll = TICK } = {},
) {
  // 72 ticks = the old 0.6s cap, plus however long the posed run-up takes to fly.
  const rebounded =
    side === "left" ? (s) => ball0(s).vx > 0 : (s) => ball0(s).vx < 0;
  const r = await api.until(rebounded, { max: max + leadTicks, poll });
  return { ball: ball0(r.snap), paddle: r.snap.paddles[side], hit: r.hit };
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
  // In gyre the moving obstacles sweep into the y=360 rally lane and deflect the ball,
  // corrupting the per-hit speed reading; pin them upright so the rally is a clean
  // paddle-to-paddle exchange (a no-op in base/multi and for an already-upright build).
  await pinObstaclesUpright(api);
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
    if (Math.sign(ball0(snap).vx) !== prevSign) {
      prevSign = Math.sign(ball0(snap).vx);
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
        const { vx } = ball0(s);
        return Math.sign(vx) === want && vx !== 0;
      },
      { max: 600, poll: 6 },
    );
    if (leftPlay || !r.hit) break;
    speeds.push(ball0(r.snap).speed);
    prevSign = want;
  }
  return speeds;
}

// ---- Input-driven helpers --------------------------------------------------
//
// These drive the game the way a player does — through input — rather than by posing
// the world with the control ops. Because they never call a control op, the game
// stays under normal player control and the paddles respond to held movement keys,
// which is exactly what a controls check must confirm.
//
// WHERE THAT INPUT GOES is the one thing the engine changes, and `pressKey`,
// `holdKey` and `releaseKey` are the only three places that know it. Under `none` it
// is the build's own injection ops (`press`, `keyDown`, `keyUp` on `window.__carom`,
// specs/instrumentation.md). Under `simple-2d` the keyboard is the engine's: the
// build registers named ACTIONS and binds keys to them (specs/modes/*.md), and the
// host drives those actions directly, so nothing synthesizes a keystroke at all.
// Callers keep naming a `KeyboardEvent.code` either way, because the key is what the
// specification binds and what a failing assertion should name.

/**
 * The engine action each of Carom's keys drives (specs/modes/single-player.md,
 * specs/modes/versus.md), for a run under an engine.
 *
 * `Escape` is deliberately absent: the case binds it to TWO actions — `pause` while
 * a match is live and `back` on a menu — and asks the build to read whichever suits
 * the screen. A driver has to make the same choice, which is what
 * `engineActionFor` does; every other key maps to exactly one action.
 */
const ENGINE_ACTION_FOR_KEY = {
  KeyW: "p1-up",
  KeyS: "p1-down",
  ArrowUp: "p2-up",
  ArrowDown: "p2-down",
  Enter: "confirm",
  Space: "confirm",
  KeyP: "pause",
  KeyM: "mute",
};

/** The screens on which a live match is running, so `Escape` means `pause` there. */
const LIVE_MATCH_SCREENS = ["playing", "countdown"];

/** The engine action `code` drives on the screen the game is currently showing. */
async function engineActionFor(api, code) {
  if (code === "Escape") {
    const { screen } = await api.snapshot();
    return LIVE_MATCH_SCREENS.includes(screen) ? "pause" : "back";
  }
  const action = ENGINE_ACTION_FOR_KEY[code];
  if (!action) {
    throw new Error(
      `no engine action is bound to ${code} in Carom (specs/modes/single-player.md, ` +
        `specs/modes/versus.md); add it to ENGINE_ACTION_FOR_KEY if the specification ` +
        `now binds it`,
    );
  }
  return action;
}

/**
 * Tap a key: press and release, firing whatever one-shot action it drives on the
 * current screen (a menu move, a confirm, a pause, a mute toggle).
 *
 * Under an engine this arms an action EDGE rather than delivering a keystroke, and
 * an edge is news for exactly one frame — the engine discards any edge the game did
 * not consume by the end of the frame it was armed in. So the tap is followed by a
 * single frame, which is what actually delivers it. That frame is `api.skip` rather
 * than `api.advance` for two reasons: a tap has to work from `arrange`, which must
 * consume no time, and one frame is not something a clip needs to show.
 */
export async function pressKey(api, code) {
  const host = await engineHost(api);
  if (!host.present) {
    await api.call("press", code);
    return;
  }
  await hostCall(api, "pressAction", await engineActionFor(api, code));
  await api.skip(1);
}

/**
 * Hold a key down, so it stays held across the frames that follow — a movement key
 * driving its paddle for as long as it is down.
 *
 * Under an engine this drives the action's magnitude to 1, which the registry treats
 * exactly as a bound key going down: it persists until released and it arms the
 * action's edge on the way, so a build reading either the held value or the press
 * sees what a player would have caused.
 */
export async function holdKey(api, code) {
  const host = await engineHost(api);
  if (!host.present) return api.call("keyDown", code);
  return hostCall(api, "setAction", await engineActionFor(api, code), 1);
}

/** Release a key held by `holdKey`, ending its held state. */
export async function releaseKey(api, code) {
  const host = await engineHost(api);
  if (!host.present) return api.call("keyUp", code);
  return hostCall(api, "setAction", await engineActionFor(api, code), 0);
}

/**
 * Start a real match from the title by navigating the menu with injected keys.
 * `mode` is "solo" (SOLO — the first menu entry, confirmed straight away) or
 * "versus" (VERSUS — one entry down). Leaves the match on its pre-serve countdown,
 * where the paddles already respond to movement input and a pause key still pauses.
 *
 * Menu navigation is instant — single taps, plus (under an engine) the one frame
 * that delivers each of them, which `pressKey` skips rather than advances — so this
 * is arrange-callable on its own, and it is the ARRANGE half of both the movement
 * and the pause scenarios.
 */
export async function startWithKeys(api, mode) {
  await api.reset();
  if (mode === "versus") await pressKey(api, "ArrowDown"); // SOLO -> VERSUS
  await pressKey(api, "Enter"); // confirm the highlighted entry
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
  await holdKey(api, code);
  await api.advance(ticks); // 36 ticks = the old 0.3s of measured motion
  const after = (await api.snapshot()).paddles;
  await api.advance(tailTicks); // 78 ticks = the old 650ms visible hold
  await releaseKey(api, code);
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
  await pressKey(api, code);
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
  await pressKey(api, code);
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
  const { vx } = ball0(await api.snapshot());
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
  const { vx } = ball0(await api.snapshot());
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
  // These shots cross the mid-field to reach the AI (e.g. a level shot at y=400 passes
  // right over obstacle B); in gyre a swaying, rotating obstacle would reach into that
  // path and deflect the shot the AI is being tested against. Pin the obstacles upright
  // so the lane is clear — this scenario tests the AI, not obstacle bounces (a no-op in
  // base/multi and for an already-upright build).
  await pinObstaclesUpright(api);
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
      const b = ball0(s);
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
  // A single-ball build reports one `ball`; the multi build reports a `balls` array.
  // Either way there is at least ball 0 to pose at the mid-field sample point.
  const snap = await api.snapshot();
  const balls = snap.balls ?? [snap.ball];
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
  const { speed } = ball0(await api.snapshot());
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
  await pressKey(api, "Escape");
  const screen = (await api.snapshot()).screen;
  const before = (await api.snapshot()).paddles[side].cy;
  await holdKey(api, code);
  await api.advance(holdTicks);
  const after = (await api.snapshot()).paddles[side].cy;
  await api.advance(tailTicks);
  await releaseKey(api, code);
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
  await pressKey(api, "Escape");
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
  // The posed flight is meant to be a straight line clear of the obstacles; in gyre a
  // swaying obstacle can drift into it (the ball is posed at x=500, on obstacle A's
  // base right face). Pin upright so the path stays clear (a no-op in base/multi and
  // for an already-upright build).
  await pinObstaclesUpright(api);
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
  // The per-face bank shots aim at an obstacle's base-x face and read which side of it
  // the ball ends on; in gyre the obstacle is swayed and tilted unless pinned, moving
  // the face off `faceX`. Pin upright so the vertical face sits exactly at its base x
  // (a no-op in base/multi and for an already-upright build).
  await pinObstaclesUpright(api);
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
    from === "left" ? (s) => ball0(s).vx < 0 : (s) => ball0(s).vx > 0;
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
//
// The list is ENGINE-DEPENDENT, because the surface itself is: under `simple-2d` the
// manual clock and keyboard injection are the engine's, so the specification strikes
// `step`, `setAutoStep`, `keyDown`, `keyUp` and `press` from `window.__carom`
// entirely and demanding them would fail a perfectly conformant build. Ask
// `requiredDebugOps(api)` for the list that applies to the run in hand; the constant
// below is the `none` list and stays exported unchanged for a caller that already has
// it.

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

/**
 * The debug-API operations this run's build must install, in the order above: all of
 * `REQUIRED_DEBUG_OPS` under `none`, and that list without the five the engine
 * provides under an engine.
 */
export async function requiredDebugOps(api) {
  const host = await engineHost(api);
  if (!host.present) return REQUIRED_DEBUG_OPS;
  return REQUIRED_DEBUG_OPS.filter(
    (op) => !ENGINE_PROVIDED_DEBUG_OPS.includes(op),
  );
}

// ---- Audio (reads the cues the build actually plays) ------------------------
//
// Audio must not autoplay: the sound only starts on the first real user interaction
// (specs/ui.md), which under `none` is the build's own doing and under an engine is
// the engine's. Either way, before driving an event whose cue is checked, arm audio
// with one neutral key press. This must be a GENUINE browser gesture
// (`api.userKey`), never a debug `press` or an engine action: a build may feed
// injected input through a purely logical path and unlock audio only from a real DOM
// event — both are conformant — so anything short of a real tap would leave the
// audio context uncreated and no cue ever scheduled, even though the build plays
// fine for a real player. `KeyZ` has no binding in Carom under either engine, so
// arming leaves game state untouched while still counting as the interaction.
//
// WHAT IS READ BACK differs, and `audioCues` is the one place that knows. Under
// `none` it is the driver's reporter-side Web Audio probe (`api.audio`), a timeline
// of every source node the build started: proof that a SOUND happened, and nothing
// more — the probe cannot know what the build meant by it. Under an engine it is the
// engine's own cue log, which is semantic: the build plays a cue BY NAME, so the log
// says which one. Both are arrays of one entry per sound, oldest first, so a caller
// that only counts them reads the same either way; `assertCuePlayed` uses the name
// as well, when there is one.

/** Carom's cue names under an engine, one per event (specs/ui.md). */
export const CUES = {
  paddleHit: "paddle-hit",
  wallBounce: "wall-bounce",
  obstacleBounce: "obstacle-bounce",
  score: "score",
};

/** Arm the build's audio with a single neutral, browser-trusted first key press. */
export async function armAudio(api) {
  await api.userKey("KeyZ");
}

/**
 * Every sound the build has played so far, oldest first: the engine's cue log under
 * an engine (entries carrying a `cue` name), the Web Audio probe under `none`
 * (entries carrying only a timestamp). Take one before an event and one after; what
 * the second has that the first does not is what the event played.
 */
export async function audioCues(api) {
  const host = await engineHost(api);
  if (!host.present) return api.audio();
  return hostCall(api, "audioLog");
}

/**
 * Assert that `event` played a sound, and — when the entries name their cue, which
 * only an engine run's do — that the sound it played was `cue`.
 *
 * `before` and `after` are what `audioCues` returned either side of the event. The
 * first assertion is the one a `none` run can make: something was played. The second
 * is what an engine run adds and the Web Audio probe never could: that the build
 * played the RIGHT one, so a build that fires its scoring blip on every wall bounce
 * is caught rather than passing on a count. Records into `check`.
 */
export function assertCuePlayed(check, { before, after, event, cue }) {
  const played = after.slice(before.length);
  check.expectGt(`${event} plays a sound`, played.length, 0);
  const named = played.filter((entry) => typeof entry?.cue === "string");
  if (cue && named.length > 0) {
    check.expectOk(
      `...and the sound it plays is the "${cue}" cue`,
      named.some((entry) => entry.cue === cue),
    );
  }
}
