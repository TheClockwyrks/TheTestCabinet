// Case-specific helpers for Shatter's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__shatter (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then time runs the real simulation forward and `snapshot` reads
// the outcome back. Nothing fabricates a result.
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time
// instant to decide the verdict, once in real time to record the media — and the
// runtime enforces the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` / plain posing helpers — control ops and instant reads
//     only. Callable from `arrange`, and they run in BOTH passes, so the record
//     pass reaches `act` in exactly the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns
//     the outcome the assertions read. Callable from `act`, and the only part
//     filmed.
//
// A helper that only poses state (`newGame`, `title`, `poseShip`, `press`,
// `poseColorScene`) is unpaired: it is arrange-callable on its own, and control ops
// are legal in `act` too (only `api.reset` is not). Everything that consumes time
// is an `actX`, and an `arrangeX` / `actX` PAIR must be used together — the act
// half assumes its arrange half posed the world.
//
// UNITS ARE TICKS. Shatter is a 120 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every DURATION passed to `api.advance` / `api.until` below
// is a tick count (the runtime converts to wall-clock for the record pass). The
// seconds these replace are noted inline. Spec quantities that are genuinely in
// seconds — the snapshot's `life`, `invuln` and `simTime` fields, and the
// `setInvuln(seconds)` control op — stay in seconds, because that is the unit the
// game reports and accepts them in.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit (`packages/browser-driver/ttc.mjs`), the single source of truth shared
// by every case. This file holds only what is specific to Shatter.

// ---- Field + simulation geometry (from constants.ts / the specs) -----------
export const FIELD_W = 1280;
export const FIELD_H = 720;
export const DEG = Math.PI / 180;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/120` seconds
// constant); pass `poll: TICK` to `api.until` when the exact instant of an event
// matters, and a coarser poll when the value being read is constant between events.
export const TICK_HZ = 120;
export const TICK = 1;

/**
 * Whole ticks in `seconds` of game time, for converting a spec quantity stated in
 * seconds into the tick count `advance`/`until` take. Throws on a duration that is
 * not a whole number of ticks rather than rounding — the debug API rejects a
 * fractional step, and silently rounding here would reintroduce exactly the drift
 * the tick unit exists to remove. Pick the tick count deliberately instead.
 */
export function ticks(seconds) {
  const n = seconds * TICK_HZ;
  if (!Number.isInteger(Math.round(n * 1e6) / 1e6) || n < 0) {
    throw new Error(`ticks(${seconds}): not a whole number of 120 Hz ticks (${n})`);
  }
  return Math.round(n);
}

export const STAR_X = 640;
export const STAR_Y = 360;
export const CORE_R = 30; // solid, non-lethal star core

export const SHIP_R = 14;
export const SHIP_THRUST = 480; // px/s^2 along facing
export const SHIP_TURN = 300 * DEG; // rad/s
export const SHIP_MAX = 680; // px/s speed cap
export const SAFE_X = 640; // respawn safe point, below the star
export const SAFE_Y = 560;
export const FACE_UP = -90 * DEG; // facing straight up (-pi/2)

export const MUZZLE_SPEED = 520; // added along the ship's facing, plus ship velocity
export const BULLET_LIFE = 1.5; // seconds (the snapshot's `life` field is in seconds)
export const MAX_BULLETS = 4;
export const FIRE_INTERVAL = 0.18; // minimum seconds between shots (21.6 ticks — not a whole tick count)

export const SAUCER_R = 18;
export const SAUCER_SCORE = 200;
export const EXTRA_LIFE_STEP = 10_000;

export const ROCK_RADIUS = { large: 46, medium: 26, small: 14 };
export const ROCK_SCORE = { large: 20, medium: 50, small: 100 };
export const SPLIT_KICK = 90; // bullet split kick (px/s)

// Warhead secondary weapon.
export const TORPEDO_SPEED = 420;
export const TORPEDO_SCATTER = 240; // torpedo-kill outward fragment kick (px/s)
export const TORPEDO_RECHARGE = 10; // seconds to recharge one torpedo (= 1200 ticks)

// ---- Geometry helpers ------------------------------------------------------
export function hyp(dx, dy) {
  return Math.hypot(dx, dy);
}

export function distToStar(body) {
  return Math.hypot(body.x - STAR_X, body.y - STAR_Y);
}

export function speedOf(body) {
  return Math.hypot(body.vx, body.vy);
}

// ---- State-only helpers (arrange) ------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * Begin a driven, in-game session on an EMPTY field with the ship safe: a real
 * game is started (state `playing`, wave 1 spawned through the real spawner),
 * then the field is cleared, the saucer removed, the score zeroed, and the ship
 * made effectively invulnerable so an isolated body under test drives the real
 * systems without a stray rock ending the run. A scenario then poses exactly the
 * bodies it needs, and `act` steps the real sim.
 *
 * `api.reset` re-arms the manual clock, which is why this is arrange-only: the
 * runtime hands the clock over between `arrange` and `act`, so calling this from
 * `act` would take it back and freeze the recording (the runtime throws).
 */
export async function newGame(api, seed = 1) {
  await api.reset({ seed });
  await api.call("startGame");
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await api.call("setInvuln", 99); // seconds — keep the ship alive through the measurement
  await api.call("setScore", 0);
}

/** Return the game to the title for a menu-driven check. Arrange-only (resets). */
export async function title(api, seed = 1) {
  await api.reset({ seed });
}

/** Pose the ship in one call (fields omitted are left unchanged). */
export async function poseShip(api, state) {
  await api.call("setShip", state);
}

// ---- Input injection -------------------------------------------------------
//
// Injecting input is instant — it sets a key's held state and applies any one-shot
// action immediately — so these are callable from either phase. A HELD key only
// moves the ship once time passes, which is `actHoldKey` below.

export async function press(api, code) {
  await api.call("press", code);
}
export async function keyDown(api, code) {
  await api.call("keyDown", code);
}
export async function keyUp(api, code) {
  await api.call("keyUp", code);
}

/**
 * ACT: hold a key, run the real sim for `tickCount` ticks, and return the ship
 * snapshot before and after. The key is released afterwards. Used by the flight and
 * control checks — a held movement/thrust key flies the ship through the game's own
 * play code as time passes, so this exercises the real key bindings rather than a
 * parallel path.
 *
 * Replaces the old `holdStep(api, code, seconds)`; the seconds callers passed
 * convert as 0.25s -> 30, 0.3s -> 36, 0.5s -> 60.
 */
export async function actHoldKey(api, code, tickCount) {
  const before = (await api.snapshot()).ship;
  await api.call("keyDown", code);
  await api.advance(tickCount);
  const after = (await api.snapshot()).ship;
  await api.call("keyUp", code);
  return { before, after };
}

// ---- Firing at rocks (armor-agnostic) --------------------------------------

/**
 * ARRANGE half of the pose-and-destroy drive: start a clean session and pose a
 * single rock of `size` on the empty field, so the shot under test is isolated.
 * `opts` may set the rock's position/velocity and (Warhead) its `health`.
 *
 * Pair with `actFireUntilGone`. Replaces the setup half of the old
 * `poseAndDestroy(api, size, opts)`.
 */
export async function arrangePosedRock(api, size, opts = {}) {
  const { seed = 1, x = 380, y = 220, vx = 0, vy = 0, health } = opts;
  await newGame(api, seed);
  const state = { x, y, vx, vy };
  if (health !== undefined) state.health = health;
  await api.call("addRock", size, state);
}

/**
 * ACT half: fire real bullets at the (single) rock of `size` on the field until it
 * is gone, re-aiming each shot at the rock's current position. Works in both
 * variants: in the base game one bullet destroys a rock, while in Warhead a rock is
 * armored, so this delivers however many hits its health takes. Returns
 * `{ hits, snap }` where `hits` is the number of bullets that landed to destroy it
 * and `snap` is the state just after it is gone. Each bullet routes through the
 * real fire/collision code (`addBullet` places a real bullet; time runs the real
 * sim).
 *
 * Replaces the old `fireUntilGone`, and the driving half of `poseAndDestroy`.
 */
export async function actFireUntilGone(api, size, { maxHits = 12, speed = 860 } = {}) {
  let hits = 0;
  const r = ROCK_RADIUS[size];
  for (; hits < maxHits; ) {
    const snap = await api.snapshot();
    const target = snap.rocks.find((rk) => rk.size === size);
    if (!target) break;
    await api.call("addBullet", {
      x: target.x - (r + 22),
      y: target.y,
      vx: speed,
      vy: 0,
    });
    // Advance until the bullet is spent (a hit consumes it; a miss expires it).
    // 84 ticks = the old 0.7s cap; poll a single tick so the exact moment of the
    // hit is not overshot into the next shot's setup.
    await api.until((s) => s.bullets.length === 0, { max: 84, poll: TICK });
    hits += 1;
  }
  return { hits, snap: await api.snapshot() };
}

// ---- Recycling (a body slung into the star, relocated to the edge) ---------

/**
 * ACT: run the real sim until the single test rock is recycled by the star —
 * detected as a sudden jump in its distance from the star (the star relocates it to
 * an off-screen edge). Returns `{ recycled, snap, peakSpeed }`, where `snap` is the
 * state the instant it re-enters and `peakSpeed` is the fastest the rock moved
 * before it was taken (so a caller can confirm the recycle reset its speed).
 *
 * Steps one tick at a time rather than using `api.until`, because the jump is
 * detected by COMPARING consecutive samples and the peak speed has to be tracked
 * across every one of them — neither survives a coarse poll.
 *
 * Replaces the old `stepUntilRecycled(api, { maxSeconds })`; the 2s the callers
 * passed is 240 ticks, and the old 3s default is 360.
 */
export async function actUntilRecycled(api, { maxTicks = 360 } = {}) {
  let snap = await api.snapshot();
  let prevD = snap.rocks[0] ? distToStar(snap.rocks[0]) : 0;
  let peakSpeed = snap.rocks[0] ? speedOf(snap.rocks[0]) : 0;
  for (let i = 0; i < maxTicks; i += 1) {
    await api.advance(TICK);
    snap = await api.snapshot();
    const rk = snap.rocks[0];
    if (!rk) return { recycled: false, snap, peakSpeed };
    const d = distToStar(rk);
    peakSpeed = Math.max(peakSpeed, speedOf(rk));
    if (d - prevD > 150 && d > 150) return { recycled: true, snap, peakSpeed };
    prevD = d;
  }
  return { recycled: false, snap, peakSpeed };
}

// ---- Wrapping --------------------------------------------------------------

/**
 * ACT: advance one tick at a time until the body `readBody(snapshot)` crosses the
 * right edge and re-enters at the left (its x drops sharply). Returns
 * `{ before, after, wrapped }` — the body just before and just after the wrap — so
 * a caller can confirm it reappeared on the far side carrying its velocity.
 *
 * Ticks one at a time, and keeps the previous sample, because the wrap is detected
 * as a discontinuity BETWEEN two consecutive states; polling coarsely would step
 * over the seam and lose the "before".
 *
 * Replaces the old `wrapAcross(api, readBody, { maxSteps })` — `maxSteps` was
 * already a fixed-step count, so it is the same number of ticks.
 */
export async function actWrapAcross(api, readBody, { maxTicks = 400 } = {}) {
  let before = readBody(await api.snapshot());
  for (let i = 0; i < maxTicks; i += 1) {
    before = readBody(await api.snapshot());
    await api.advance(TICK);
    const after = readBody(await api.snapshot());
    if (after && before && after.x < before.x - 100) {
      return { before, after, wrapped: true };
    }
  }
  return { before, after: readBody(await api.snapshot()), wrapped: false };
}

// ---- Color sampling (reads the rendered canvas, not a reported value) -------
//
// The color checks read the pixels the build actually PAINTS, through the
// driver's `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas, so
// a logical field coordinate maps to a fraction by dividing by the field size and
// a script never has to know the canvas's pixel dimensions. Reading the rendered
// pixel (rather than a color the game merely reports) means a build cannot pass by
// returning a value it does not draw.

// On-field sample centers (logical px) for the posed color scene below.
export const COLOR_POINTS = {
  ship: { x: 300, y: 300 },
  rock: { x: 940, y: 300 },
  saucer: { x: 300, y: 560 },
  star: { x: STAR_X, y: STAR_Y },
  background: { x: 120, y: 650 },
};

export function colorDist(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

async function sampleAt(api, x, y) {
  const p = await api.pixel(x / FIELD_W, y / FIELD_H);
  return { r: p.r, g: p.g, b: p.b };
}

/**
 * The representative rendered color of an element drawn around `(cx, cy)`: sample
 * the center and several concentric rings out to the element's footprint and
 * return the pixel that stands farthest from the field background `bg`. For a
 * neon-outline shape that is the bright stroke/glow the element is drawn in, so
 * this reads "what color is this element" for a filled or an outlined design
 * alike.
 */
export async function elementColor(api, cx, cy, radii, bg) {
  let best = await sampleAt(api, cx, cy);
  let bestD = colorDist(best, bg);
  for (const rr of radii) {
    for (let k = 0; k < 24; k += 1) {
      const a = (k / 24) * Math.PI * 2;
      const c = await sampleAt(api, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      const d = colorDist(c, bg);
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  return best;
}

/**
 * ARRANGE: pose a clean scene for the color checks — a live game with the field
 * cleared to a single large rock, the ship, and a saucer each at a known,
 * unobstructed spot, the star at the center, and the ship made permanently visible
 * (invuln cleared, so its respawn blink never hides it). Nothing is stepped, so
 * every body stays exactly where it is posed while the pixels are sampled.
 *
 * Pair with `actSampleScene`. The paint settle the old version ended with has moved
 * there, next to the pixel reads it exists for.
 */
export async function poseColorScene(api, seed = 1) {
  await api.reset({ seed });
  await api.call("startGame");
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await api.call("setInvuln", 0); // no respawn blink: the ship is always drawn
  await api.call("setShip", {
    x: COLOR_POINTS.ship.x,
    y: COLOR_POINTS.ship.y,
    vx: 0,
    vy: 0,
    angle: FACE_UP,
  });
  await api.call("addRock", "large", {
    x: COLOR_POINTS.rock.x,
    y: COLOR_POINTS.rock.y,
    vx: 0,
    vy: 0,
  });
  await api.call("spawnSaucer");
  await api.call("setSaucer", {
    x: COLOR_POINTS.saucer.x,
    y: COLOR_POINTS.saucer.y,
    vx: 0,
    vy: 0,
  });
}

/**
 * ACT: sample the four scene colors (ship, rock, saucer, star) plus the background
 * from the pixels the build actually painted.
 *
 * Settles first, in REAL time in both passes (`api.settle`, not `api.advance`),
 * because a pixel read needs a FRAME to have been painted since the scene was
 * posed, and instant stepping never produces one. Advancing the simulation would be
 * wrong twice over: it would not paint anything in the validate pass, and it would
 * let the posed bodies drift out from under the sample points.
 *
 * Replaces the old `sampleScene`, and absorbs the `api.wait(140)` that used to end
 * `poseColorScene`.
 */
export async function actSampleScene(api, { settleMs = 140 } = {}) {
  await api.settle(settleMs); // let a frame paint the posed scene
  const bg = await sampleAt(api, COLOR_POINTS.background.x, COLOR_POINTS.background.y);
  const ship = await elementColor(api, COLOR_POINTS.ship.x, COLOR_POINTS.ship.y, [6, 12, 17], bg);
  const rock = await elementColor(api, COLOR_POINTS.rock.x, COLOR_POINTS.rock.y, [28, 38, 46], bg);
  const saucer = await elementColor(api, COLOR_POINTS.saucer.x, COLOR_POINTS.saucer.y, [8, 14, 20], bg);
  const star = await elementColor(api, COLOR_POINTS.star.x, COLOR_POINTS.star.y, [0, 8, 16], bg);
  return { bg, ship, rock, saucer, star };
}

/**
 * ARRANGE: the standard color scene (ship, rock, saucer, star) with a torpedo readied.
 * The ship is posed facing straight up (poseColorScene) so a launched torpedo climbs the
 * empty top of the field — none of the posed bodies sit inside its forward acquisition
 * cone, so it flies straight rather than homing onto one and leaving the sample point.
 *
 * Pair with `actSampleTorpedoScene`.
 */
export async function arrangeTorpedoColorScene(api, seed = 1) {
  await poseColorScene(api, seed);
  await api.call("setTorpedoReady", true);
}

/**
 * ACT: launch the torpedo, carry it clear of the ship, then sample the rendered colors of
 * the whole scene plus the torpedo itself. Returns `{ bg, ship, rock, saucer, star, torpedo,
 * launched }` — `torpedo` is the acid-green the build actually paints the munition in, read
 * at the torpedo's own position (which the launch reports), and `launched` says a torpedo
 * was in flight to sample.
 *
 * The launch is instant and `advance` steps the sim instantly in the validate pass, so the
 * posed bodies stay put (the ship and saucer are unpowered by gravity, the rock barely
 * drifts in the few ticks, the star is fixed) while the torpedo separates from the ship;
 * `actSampleScene` then settles a real frame so the pixels can be read.
 */
export async function actSampleTorpedoScene(api, { settleMs = 140, launchTicks = 20 } = {}) {
  await api.call("press", "KeyF"); // launch straight up, off every posed body's cone
  await api.advance(launchTicks); // carry it clear of the ship (instant in the validate pass)
  const scene = await actSampleScene(api, { settleMs });
  const t = (await api.snapshot()).torpedoes[0];
  const torpedo = t
    ? await elementColor(api, t.x, t.y, [4, 8, 12, 16], scene.bg)
    : null;
  return { ...scene, torpedo, launched: Boolean(t) };
}

// ---- Audio (reads the Web Audio cues the build actually schedules) ----------
//
// Shatter's audio is synthesized with the Web Audio API (specs/ui.md), so the driver
// reports every source the build starts (see `api.audio`). The game must not autoplay: it
// creates its AudioContext only on the first user interaction, so before driving an event
// whose cue is checked, inject one neutral key press to arm audio. A key with no game
// binding leaves state untouched while still counting as the first interaction. From there
// `api.audio` reports every Web Audio source the build starts, so a cue is confirmed by the
// log growing across the event.

/** Arm the build's audio with a single neutral first key press. */
export async function armAudio(api) {
  await api.call("press", "KeyZ");
}
