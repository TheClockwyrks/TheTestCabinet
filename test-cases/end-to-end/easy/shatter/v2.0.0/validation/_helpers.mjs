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
// are legal in `act` too. Everything that consumes time is an `actX`, and an
// `arrangeX` / `actX` PAIR must be used together — the act half assumes its arrange
// half posed the world.
//
// The reset-bearing helpers stay arrange-only by CONVENTION, not because the
// runtime rejects them: `api.reset` works in `act` (the runtime hands the clock
// straight back afterwards, so the recording keeps running). Starting a scenario
// over mid-`act` still breaks the clip into two takes with a title screen between
// them, so an item that needs two scenarios is better written to reach the second
// with setters — which is what the paired helpers below do.
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
    throw new Error(
      `ticks(${seconds}): not a whole number of 120 Hz ticks (${n})`,
    );
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
export const SHIP_DRAG_HALFLIFE = 3.0; // seconds to lose half speed (specs/ship.md)
export const SAFE_X = 640; // respawn safe point, below the star
export const SAFE_Y = 560;
// Facing straight up. The spec states this as "270 degrees" (specs/ship.md) and as
// -pi/2 (the snapshot's radians); they are the same direction, and a build may report
// either. Never compare a facing to this with plain subtraction — use `angleDelta`.
export const FACE_UP = -90 * DEG;

/**
 * The slowest speed a build can plateau at while thrusting flat out and still be
 * capping correctly: the cap with ONE step of drag taken off it.
 *
 * `specs/ship.md` fixes the cap (680 px/s, "applied after thrust each step") and the
 * drag (`0.5 ^ (dt / 3.0)`, "each step"), but not their order relative to each other
 * within a step. A build that clamps and then drags reports this; one that drags and
 * then clamps reports the cap exactly. Both clamp after thrust, both hit the cap, and
 * neither ever exceeds it — the whole difference is which of the two the end-of-step
 * snapshot happens to be read after, and it is under a fifth of a percent.
 */
export const SHIP_MAX_PLATEAU =
  SHIP_MAX * Math.pow(0.5, 1 / TICK_HZ / SHIP_DRAG_HALFLIFE);

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

/**
 * The rotation from facing `from` to facing `to`, as the SHORTEST signed turn, in
 * (-pi, pi]. Negative is counter-clockwise, positive clockwise.
 *
 * ALWAYS compare facings and headings through this, never by subtracting them. An
 * angle names a direction, and the same direction has infinitely many numbers:
 * straight up is -pi/2 and 3pi/2 and -5pi/2. Nothing in the case picks between them
 * — `specs/instrumentation.md` says only that angles are "in radians", and
 * `specs/ship.md` writes the spawn facing as "270 degrees" (3pi/2) in the same breath
 * as the snapshot reports radians — so a build is free to keep its facing in
 * [0, 2pi), in (-pi, pi], or unbounded, and all three are the same ship pointing the
 * same way.
 *
 * Plain subtraction reads that free choice as a fault. A ship at 0 turned 150 degrees
 * counter-clockwise sits at -2.618 in one convention and at 3.665 in another; the raw
 * difference calls the second a 210-degree turn the CLOCKWISE way, and fails a build
 * that turned exactly as far, exactly the right way, as its own screen shows. Going
 * through `atan2` puts the answer back on the shortest arc, so it reads the same on
 * every convention.
 *
 * The one thing this cannot express is a turn of more than half a circle, which
 * aliases to the short way round; keep measured turns under 180 degrees.
 */
export function angleDelta(from, to) {
  const d = to - from;
  return Math.atan2(Math.sin(d), Math.cos(d));
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
 * This is arrange-only by convention: it starts a scenario from scratch, and doing
 * that inside `act` cuts the recording into two takes with a title screen between
 * them. An item that needs a second scenario reaches it with setters instead.
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

/**
 * ACT: tap the fire key and let the shot leave, returning
 * `{ before, after, bullet }` — the bullet counts either side of the tap and the
 * round that was launched (the newest one on the field, or `undefined` if none
 * was).
 *
 * The single tick is the point of this helper. Firing is a SIMULATION event, and
 * `specs/instrumentation.md` is explicit that a tap is "a `keyDown` immediately
 * followed by a `keyUp`" routed through "the same handling the real keyboard
 * feeds" — it lists the one-shot actions applied immediately as the menu, pause
 * and mute ones, all of which are screen state rather than world state. So a build
 * may legitimately launch the round inside `press` OR latch the tap and launch it
 * on the next fixed step, exactly as a real key tap does; both drive the same
 * bindings and both are what a player sees. Reading the bullet count with NO time
 * elapsed only ever sees the first kind, and fails a conformant build of the
 * second kind for a shot it does fire. Advancing one tick — the smallest amount
 * the contract can express — sees both.
 */
export async function actTapFire(api) {
  const before = (await api.snapshot()).bullets.length;
  await api.call("press", "Space");
  await api.advance(TICK); // the shot is a simulation event; give it its step
  const snap = await api.snapshot();
  return {
    before,
    after: snap.bullets.length,
    bullet: snap.bullets[snap.bullets.length - 1],
    snap,
  };
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
 *
 * `standoff` is how far OUTSIDE the rock's surface each bullet starts. It exists
 * for the recording: the record pass films `act`, so a bullet placed on the rock's
 * doorstep resolves its hit within a couple of frames and the clip is over before
 * anything is on screen. 140 px at 860 px/s is a sixth of a second of visible
 * travel — long enough to read as a shot, short enough that neither the bullet's
 * gravity deflection (well under a pixel over that distance, against collision
 * radii of 17 to 49) nor the rock's own drift can turn an aimed shot into a miss.
 * The verdict is unaffected either way: the validate pass steps instantly.
 *
 * `dwell` then keeps the sim running once the rock is gone, so the clip shows what
 * the kill PRODUCED — fragments springing apart, a score ticking over — instead of
 * cutting on the frame of the hit. `snap` is taken BEFORE it, so the assertions
 * still read the field the instant the rock died. A caller driving several kills in
 * a row shortens it, to keep the whole sequence inside the run it set up.
 */
export async function actFireUntilGone(
  api,
  size,
  { maxHits = 12, speed = 860, standoff = 140, dwell = 90 } = {},
) {
  let hits = 0;
  const r = ROCK_RADIUS[size];
  for (; hits < maxHits; ) {
    const snap = await api.snapshot();
    const target = snap.rocks.find((rk) => rk.size === size);
    if (!target) break;
    await api.call("addBullet", {
      x: target.x - (r + standoff),
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
  const snap = await api.snapshot();
  await api.advance(dwell); // film what the kill produced
  return { hits, snap };
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
 *
 * `dwell` keeps the sim running for a beat AFTER the recycle is detected, purely
 * so the recording shows the exchange complete — the star takes the rock and the
 * replacement drifts in from the edge. Without it the clip cuts on the frame the
 * rock reaches the core, which is the one frame that shows nothing. `snap` is
 * captured BEFORE the dwell, so what the assertions read is still the state the
 * instant the star acted.
 */
export async function actUntilRecycled(
  api,
  { maxTicks = 360, dwell = 96 } = {},
) {
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
    if (d - prevD > 150 && d > 150) {
      await api.advance(dwell); // film the replacement entering
      return { recycled: true, snap, peakSpeed };
    }
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
 *
 * `dwell` runs on for a beat AFTER the seam is crossed, so the recording shows the
 * body carry on across the far side rather than cutting on the single frame it
 * reappears. The `before`/`after` pair the assertions read straddles the seam and
 * is captured first, so the dwell cannot move it. Callers pose the body a good
 * distance BACK from the edge for the same reason — a body posed on the seam has
 * already wrapped by the time the clip's first frame is painted.
 */
export async function actWrapAcross(
  api,
  readBody,
  { maxTicks = 400, dwell = 60 } = {},
) {
  // Each sample becomes the next comparison's "before", so consecutive pairs are
  // CONTIGUOUS. Re-reading the body at the top of every iteration instead would
  // leave a gap between one pair's second read and the next pair's first — time
  // that passes unobserved in the record pass, where the build drives its own
  // clock and keeps moving between calls. A body that crossed the seam inside
  // that gap shows up in neither pair, the wrap is missed, and the sweep runs its
  // whole budget out filming laps of the field instead of stopping on the
  // crossing. (The verdict never depended on this — the validate pass advances
  // only inside `advance`, so it has no gap to lose the seam in.) Carrying the
  // sample forward also halves the snapshot round trips per tick.
  let prev = readBody(await api.snapshot());
  for (let i = 0; i < maxTicks; i += 1) {
    await api.advance(TICK);
    const cur = readBody(await api.snapshot());
    if (cur && prev && cur.x < prev.x - 100) {
      await api.advance(dwell); // film the far side
      return { before: prev, after: cur, wrapped: true };
    }
    prev = cur;
  }
  return {
    before: prev,
    after: readBody(await api.snapshot()),
    wrapped: false,
  };
}

// ---- Losing a ship ---------------------------------------------------------
//
// WHAT `lives` COUNTS IS NOT FIXED BY THE SPEC, so nothing here compares it to an
// absolute number. `specs/gameplay.md` says "A game starts with 3 ships", while
// `specs/instrumentation.md` defines the snapshot field as "ships in RESERVE" and
// `setLives(n)` as setting "the number of ships in reserve" — and `specs/ui.md`
// draws "one [glyph] per life still in reserve". A build that starts three ships
// and reports `lives: 2` (the two in reserve behind the one being flown) satisfies
// every one of those sentences; so does one that reports `lives: 3`. Both are
// conformant, so a check that reads 3 out of a fresh game is testing a convention
// the case never picked.
//
// The mechanical facts the spec DOES fix are relative, and these helpers express
// them that way: losing a ship costs exactly one life, a loss with ships left
// respawns rather than ending the run, and the run ends on the loss of the last of
// the three. So a life count is only ever compared against one this same run read
// earlier, and "the game ended" is read from `screen`, never from `lives` reaching
// a particular value.

/** ARRANGE: pose the ship at `at` with a rock sitting on it, so the next steps kill it. */
export async function arrangeDoomedShip(api, at = { x: 300, y: 300 }) {
  await api.call("setShip", { x: at.x, y: at.y, vx: 0, vy: 0, angle: 0 });
  await api.call("addRock", "small", { x: at.x, y: at.y, vx: 0, vy: 0 });
}

/**
 * ACT: run the real sim until the ship posed at `at` is lost, and then until the
 * game has resolved that loss — either the next ship is out or the run is over.
 * Returns `{ before, lost, respawned, ended }`:
 *
 *   * `before`   — the snapshot the drive started from (its life baseline).
 *   * `lost`     — the `until` result for the loss itself: `hit` says a life was
 *                  taken (or the run ended), `snap` is the state at that instant.
 *   * `respawned`— the `until` result for the NEXT ship being out on the field,
 *                  read the instant it appears, while its grace window is still
 *                  counting down.
 *   * `ended`    — whether the run finished instead of respawning.
 *
 * The two waits are separate because the spec does not say WHEN the life comes off
 * the count — a build may decrement it the moment the ship is hit, or when the
 * replacement launches — and it does not bound the pause between the two either. A
 * single wait on the life count therefore lands at a different moment on different
 * conformant builds, and reading a respawn pose out of it can catch the wreck of
 * the old ship rather than the new one. Waiting for the count to move and THEN for
 * a ship to be somewhere other than where this drive posed the last one lands on
 * the new ship on any build. `max` is deliberately generous for the same reason:
 * the death pause is the build's to choose.
 */
export async function actUntilShipLost(
  api,
  { at = { x: 300, y: 300 }, max = ticks(6), lives } = {},
) {
  const before = await api.snapshot();
  // The count the loss is measured against. It defaults to right now, but a caller
  // that has already spent time on the doomed ship passes the count from BEFORE
  // that, because the loss may have landed inside it. Only the record pass can get
  // there: its sweeps run on the wall clock, so the same `until` covers more game
  // than the validate pass's exact stepping did, and a wait that was still watching
  // a protected ship when the verdict was decided can be watching a dead one here.
  // Re-baselining on the way in would then be waiting for a SECOND loss that the
  // scenario never arranged — burning the whole clip budget on an empty field and
  // cutting the recording off after the very thing it exists to show.
  const baseline = lives === undefined ? before.lives : lives;
  const lost = await api.until(
    (s) => s.lives < baseline || s.screen !== "playing",
    { max, poll: TICK },
  );
  if (!lost.hit || lost.snap.screen !== "playing") {
    return {
      before,
      lost,
      respawned: lost,
      ended: lost.snap.screen === "gameover",
    };
  }
  const respawned = await api.until(
    (s) => s.screen !== "playing" || hyp(s.ship.x - at.x, s.ship.y - at.y) > 1,
    { max, poll: TICK },
  );
  return {
    before,
    lost,
    respawned,
    ended: respawned.snap.screen !== "playing",
  };
}

/**
 * ACT: force one clean loss of the ship and wait it out — clear the field so only
 * this drive's rock can be the cause, drop the grace window so the collision is
 * live, pose the ship on the rock, and run. Returns what `actUntilShipLost` does.
 *
 * The field is cleared each time so a drifting wave rock can never sneak in a
 * second, uncounted death; the ship is re-posed each time because a respawn
 * replaces it wherever the build puts it.
 */
export async function actForceDeath(
  api,
  { at = { x: 300, y: 300 }, max = ticks(6) } = {},
) {
  await api.call("clearRocks");
  await api.call("setInvuln", 0);
  await arrangeDoomedShip(api, at);
  return actUntilShipLost(api, { at, max });
}

/**
 * ACT: lose ship after ship from the state the game is in now until the run ends,
 * and report how many losses that took. Returns `{ losses, ended, states, snap }`,
 * where `states[i]` is the screen the game was on after loss `i + 1` — so a caller
 * can say "still playing after the first two, over after the third" without ever
 * reading a life count.
 *
 * `maxLosses` only bounds a runaway drive against a build that never ends its run;
 * `ended` is what says the game finished.
 */
export async function actLoseEveryShip(
  api,
  { maxLosses = 8, at = { x: 300, y: 300 } } = {},
) {
  const states = [];
  let losses = 0;
  let snap = await api.snapshot();
  for (let i = 0; i < maxLosses && snap.screen === "playing"; i += 1) {
    const death = await actForceDeath(api, { at });
    if (!death.lost.hit) break; // the build never took the life; leave it to the caller
    losses += 1;
    snap = death.respawned.snap;
    states.push(snap.screen);
    if (death.ended) break;
  }
  return { losses, ended: snap.screen === "gameover", states, snap };
}

// ---- Shooting the saucer down ----------------------------------------------

/**
 * ACT: shoot the saucer down with real bullets, re-aiming at where it actually is
 * before each shot. Returns the `until` result of the shot that removed it (or of
 * the last one fired).
 *
 * It re-aims rather than firing one perfectly placed round because the saucer is
 * under its own power: it weaves and it steers around the star, so where it will
 * be when a bullet arrives is the BUILD's business, not something a script may
 * assume. `standoff` gives the round a visible run at it for the recording, and
 * re-aiming is what keeps that run from turning a demonstration into a miss.
 */
export async function actShootDownSaucer(
  api,
  { standoff = 160, speed = 860, maxShots = 4 } = {},
) {
  let result = { snap: await api.snapshot(), hit: false, spent: 0 };
  for (let i = 0; i < maxShots; i += 1) {
    const u = (await api.snapshot()).saucer;
    if (!u) break;
    await api.call("addBullet", {
      x: u.x - standoff,
      y: u.y,
      vx: speed,
      vy: 0,
    });
    result = await api.until(
      (s) => s.saucer === null || s.bullets.length === 0,
      {
        max: ticks(0.7),
        poll: TICK,
      },
    );
    if (!result.snap.saucer) break;
  }
  return result;
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
      const c = await sampleAt(
        api,
        cx + Math.cos(a) * rr,
        cy + Math.sin(a) * rr,
      );
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
  const bg = await sampleAt(
    api,
    COLOR_POINTS.background.x,
    COLOR_POINTS.background.y,
  );
  const ship = await elementColor(
    api,
    COLOR_POINTS.ship.x,
    COLOR_POINTS.ship.y,
    [6, 12, 17],
    bg,
  );
  const rock = await elementColor(
    api,
    COLOR_POINTS.rock.x,
    COLOR_POINTS.rock.y,
    [28, 38, 46],
    bg,
  );
  const saucer = await elementColor(
    api,
    COLOR_POINTS.saucer.x,
    COLOR_POINTS.saucer.y,
    [8, 14, 20],
    bg,
  );
  const star = await elementColor(
    api,
    COLOR_POINTS.star.x,
    COLOR_POINTS.star.y,
    [0, 8, 16],
    bg,
  );
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
export async function actSampleTorpedoScene(
  api,
  { settleMs = 140, launchTicks = 20 } = {},
) {
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
// creates (or resumes) its AudioContext only on the first real user interaction, so before
// driving an event whose cue is checked, arm audio with one neutral key press. This must be a
// GENUINE browser gesture (`api.userKey`), not a debug `press`: a build may feed the debug API
// through a purely logical input path and unlock audio only from a real DOM event — both are
// conformant — so a debug press would leave its AudioContext uncreated and no cue would ever
// be scheduled, even though the build plays fine for a real player. A key with no game binding
// leaves state untouched while still counting as the interaction. From there `api.audio`
// reports every Web Audio source the build starts, so a cue is confirmed by the log growing
// across the event.

/** Arm the build's audio with a single neutral, browser-trusted first key press. */
export async function armAudio(api) {
  await api.userKey("KeyZ");
}
