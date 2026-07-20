// Case-specific helpers for Shatter's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__shatter (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then `step` runs the real simulation forward and `snapshot`
// reads the outcome back. Nothing fabricates a result. These helpers factor out
// the common "arrange the world, step the real sim, read what happened" patterns
// and the field geometry the scripts depend on (mirrored from the spec /
// constants).
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit the driver hands every `drive(api, ttc)` (see
// `packages/browser-driver/ttc.mjs`), the single source of truth shared by every
// case. This file holds only what is specific to Shatter.

// ---- Field + simulation geometry (from constants.ts / the specs) -----------
export const FIELD_W = 1280;
export const FIELD_H = 720;
export const FIXED = 1 / 120; // physics timestep (matches FIXED_STEP)
export const DEG = Math.PI / 180;

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
export const BULLET_LIFE = 1.5; // seconds
export const MAX_BULLETS = 4;
export const FIRE_INTERVAL = 0.18; // minimum seconds between shots

export const SAUCER_R = 18;
export const SAUCER_SCORE = 200;
export const EXTRA_LIFE_STEP = 10_000;

export const ROCK_RADIUS = { large: 46, medium: 26, small: 14 };
export const ROCK_SCORE = { large: 20, medium: 50, small: 100 };
export const SPLIT_KICK = 90; // bullet split kick (px/s)

// Warhead secondary weapon.
export const TORPEDO_SPEED = 420;
export const TORPEDO_SCATTER = 240; // torpedo-kill outward fragment kick (px/s)
export const TORPEDO_RECHARGE = 10; // seconds to recharge one torpedo

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

// ---- Stepping --------------------------------------------------------------

/**
 * Advance the real simulation in fixed-step chunks until `predicate(snapshot)`
 * holds, or until `maxSeconds` of game time elapse. Returns the last snapshot and
 * whether the predicate was met.
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

// ---- Scenario setup --------------------------------------------------------

/**
 * Begin a driven, in-game session on an EMPTY field with the ship safe: a real
 * game is started (state `playing`, wave 1 spawned through the real spawner),
 * then the field is cleared, the saucer removed, the score zeroed, and the ship
 * made effectively invulnerable so an isolated body under test drives the real
 * systems without a stray rock ending the run. Manual stepping is armed (reset).
 * A scenario then poses exactly the bodies it needs and steps the real sim.
 */
export async function newGame(api, seed = 1) {
  await api.reset({ seed });
  await api.call("startGame");
  await api.call("clearRocks");
  await api.call("removeSaucer");
  await api.call("setInvuln", 99); // keep the ship alive through the measurement
  await api.call("setScore", 0);
}

/** Return the game to the title (manual clock re-armed) for a menu-driven check. */
export async function title(api, seed = 1) {
  await api.reset({ seed });
}

/** Pose the ship in one call (fields omitted are left unchanged). */
export async function poseShip(api, state) {
  await api.call("setShip", state);
}

// ---- Firing at rocks (armor-agnostic) --------------------------------------

/**
 * Fire real bullets at the (single) rock of `size` on the field until it is gone,
 * re-aiming each shot at the rock's current position. Works in both variants: in
 * the base game one bullet destroys a rock, while in Warhead a rock is armored, so
 * this delivers however many hits its health takes. Returns `{ hits, snap }` where
 * `hits` is the number of bullets that landed to destroy it and `snap` is the
 * state just after it is gone. Each bullet routes through the real fire/collision
 * code (`addBullet` places a real bullet; `step` runs the real sim).
 */
export async function fireUntilGone(api, size, { maxHits = 12, speed = 860 } = {}) {
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
    // Step until the bullet is spent (a hit consumes it; a miss expires it).
    await stepUntil(api, (s) => s.bullets.length === 0, 0.7, FIXED);
    hits += 1;
  }
  return { hits, snap: await api.snapshot() };
}

/**
 * Pose a single rock on an empty field and destroy it with the primary gun.
 * Returns `{ hits, snap }` (see fireUntilGone). `opts` may set the rock's
 * position/velocity and (Warhead) its `health`.
 */
export async function poseAndDestroy(api, size, opts = {}) {
  const { seed = 1, x = 380, y = 220, vx = 0, vy = 0, health } = opts;
  await newGame(api, seed);
  const state = { x, y, vx, vy };
  if (health !== undefined) state.health = health;
  await api.call("addRock", size, state);
  return fireUntilGone(api, size);
}

// ---- Recycling (a body slung into the star, relocated to the edge) ---------

/**
 * Step the real sim until the single test rock is recycled by the star — detected
 * as a sudden jump in its distance from the star (the star relocates it to an
 * off-screen edge). Returns `{ recycled, snap, peakSpeed }`, where `snap` is the
 * state the instant it re-enters and `peakSpeed` is the fastest the rock moved
 * before it was taken (so a caller can confirm the recycle reset its speed).
 */
export async function stepUntilRecycled(api, { maxSeconds = 3 } = {}) {
  let snap = await api.snapshot();
  let prevD = snap.rocks[0] ? distToStar(snap.rocks[0]) : 0;
  let peakSpeed = snap.rocks[0] ? speedOf(snap.rocks[0]) : 0;
  const iters = Math.ceil(maxSeconds / FIXED);
  for (let i = 0; i < iters; i += 1) {
    await api.step(FIXED);
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
 * Step one fixed step at a time until the body `readBody(snapshot)` crosses the
 * right edge and re-enters at the left (its x drops sharply). Returns
 * `{ before, after, wrapped }` — the body just before and just after the wrap —
 * so a caller can confirm it reappeared on the far side carrying its velocity.
 */
export async function wrapAcross(api, readBody, { maxSteps = 400 } = {}) {
  let before = readBody(await api.snapshot());
  for (let i = 0; i < maxSteps; i += 1) {
    before = readBody(await api.snapshot());
    await api.step(FIXED);
    const after = readBody(await api.snapshot());
    if (after && before && after.x < before.x - 100) {
      return { before, after, wrapped: true };
    }
  }
  return { before, after: readBody(await api.snapshot()), wrapped: false };
}

// ---- Input injection -------------------------------------------------------

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
 * Hold a key, step the real sim for a deterministic verdict, and return the ship
 * snapshot before and after. The key is released afterwards. Used by the flight
 * and control checks — a held movement/thrust key flies the ship through the
 * game's own play code when stepped.
 */
export async function holdStep(api, code, seconds) {
  const before = (await api.snapshot()).ship;
  await api.call("keyDown", code);
  await api.step(seconds);
  const after = (await api.snapshot()).ship;
  await api.call("keyUp", code);
  return { before, after };
}

// ---- Live motion clip ------------------------------------------------------

/**
 * Hand the clock back to the game and let real time pass, so a video output
 * captures on-screen motion (stepping advances the sim instantly and animates
 * nothing). Call AFTER the deterministic measurement; the verdict is already
 * decided from the recorded assertions. The manual clock is not needed again, so
 * this is the last thing a video script does.
 */
export async function liveClip(api, ms = 800) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
}

/** As liveClip, but keep `code` held so the ship visibly turns/thrusts. */
export async function liveHold(api, code, ms = 800) {
  await api.call("keyDown", code);
  await api.call("setAutoStep", true);
  await api.wait(ms);
  await api.call("keyUp", code);
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
 * Pose a clean scene for the color checks: a live game with the field cleared to a
 * single large rock, the ship, and a saucer each at a known, unobstructed spot,
 * the star at the center, and the ship made permanently visible (invuln cleared,
 * so its respawn blink never hides it). Nothing is stepped, so every body stays
 * exactly where it is posed while the pixels are sampled and the scene captured.
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
  await api.wait(140); // let a frame paint the posed scene
}

/** Sample the four scene colors (ship, rock, saucer, star) plus the background. */
export async function sampleScene(api) {
  const bg = await sampleAt(api, COLOR_POINTS.background.x, COLOR_POINTS.background.y);
  const ship = await elementColor(api, COLOR_POINTS.ship.x, COLOR_POINTS.ship.y, [6, 12, 17], bg);
  const rock = await elementColor(api, COLOR_POINTS.rock.x, COLOR_POINTS.rock.y, [28, 38, 46], bg);
  const saucer = await elementColor(api, COLOR_POINTS.saucer.x, COLOR_POINTS.saucer.y, [8, 14, 20], bg);
  const star = await elementColor(api, COLOR_POINTS.star.x, COLOR_POINTS.star.y, [0, 8, 16], bg);
  return { bg, ship, rock, saucer, star };
}
