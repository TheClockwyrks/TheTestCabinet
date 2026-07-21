// Case-specific helpers for Spectra's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__spectra (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then time runs the real systems forward and `snapshot` reads the
// outcome back. Nothing fabricates a result. These helpers factor out the common
// "pose a scenario, run the real sim, read what happened" patterns and the field
// geometry the items depend on (mirrored from the spec / constants).
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
//
// A helper that only poses state or only reads (`startClean`, `startStageClean`,
// `spawnDrone`, `shootDrone`, `shieldBullet`, `findDrone`, …) is unpaired: it is
// arrange-callable on its own, and — because control ops never touch the step
// clock — it is equally callable from `act` when a scenario has to be re-posed
// mid-phase. `api.reset()` is the exception: the runtime forbids it in `act`
// (it would take the clock back and freeze the recording), so any helper that
// resets is arrange-only. Those are called out below.
//
// UNITS ARE TICKS. Spectra runs a 120 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every duration passed to `api.advance` / `api.until` is a
// tick count (the runtime converts to wall-clock for the record pass). The
// constants below that describe a GAME FACT asserted against a snapshot — the fire
// cadence, the flip lockout — stay in SECONDS, because that is the unit the
// snapshot reports them in; each such constant has a `_TICKS` twin where a script
// also needs to step by it.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit (`packages/browser-driver/ttc.mjs`), the single source of truth shared
// by every case. This file holds only what is specific to Spectra.

// ---- Geometry & constants (from specs + the canonical constants) -----------
export const FIELD_W = 1280;
export const FIELD_H = 720;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/120` seconds
// constant); pass `poll: TICK` to `api.until` when the exact instant of an event
// matters. `SEC_PER_TICK` is only for turning a measured tick count back into the
// seconds a snapshot field is expressed in.
export const TICK_HZ = 120;
export const TICK = 1;
export const SEC_PER_TICK = 1 / TICK_HZ;

export const SHIP_Y = 600; // fixed ship lane center y
export const SHIP_MIN_X = 40;
export const SHIP_MAX_X = 1240;
export const SHIP_SPEED = 360; // px/s while a direction is held

// Note: the fire cadence is NOT a whole number of ticks (0.16 s x 120 = 19.2), so
// there is no `FIRE_CADENCE_TICKS`. A cadence check steps one tick at a time and
// accumulates `SEC_PER_TICK`, then compares the measured gap against the seconds
// value with the spec's tolerance.
export const FIRE_CADENCE = 0.16; // seconds between shots
export const PBULLET_CAP = 3; // max player bullets alive
export const FLIP_LOCKOUT = 0.3; // post-flip fire lockout, seconds
export const FLIP_LOCKOUT_TICKS = 36; // 0.30 s

export const RES_ABSORB = 6; // resonance per absorbed same-band bullet
export const RES_KILL = 4; // resonance per matching kill
export const RES_MAX = 100;

export const SWAY_AMP = 20; // formation sway amplitude, px
export const SWAY_PERIOD = 5; // formation sway period, seconds
export const SWAY_PERIOD_TICKS = 600; // 5 s
export const SWAY_PEAK_T = 1.25; // waveTime of the +amplitude peak
export const SWAY_PEAK_TICKS = 150; // 1.25 s
export const SWAY_TROUGH_T = 3.75; // waveTime of the -amplitude trough
export const SWAY_TROUGH_TICKS = 450; // 3.75 s

export const DIVE_SPEED = 300; // stage-1 dive speed, px/s
export const PRISM_INVERT_Y = 640; // a diving Prism crossing this inverts the field
export const EXTRA_LIFE_AT = 20000;
export const READY_HOLD = 1.3; // seconds of READY hold after a hit
export const READY_HOLD_TICKS = 156; // 1.3 s

// ---- Scenario setup (arrange only — these reset) ----------------------------
//
// Both call `api.reset`, which the runtime allows in `arrange` and forbids in
// `act`. To re-pose a second scenario inside `act`, use `clearField` plus the
// spawn helpers instead — they set state without touching the step clock.

/**
 * Begin stage 1's live wave from a clean slate: reset (reseed + arm the manual
 * clock), start the mode from the title into the first wave, and — by default —
 * clear the auto-built wave so a scenario poses exactly what it wants. After this
 * the game is `inWave` with an empty field, ready to pose drones/bullets.
 */
export async function startClean(api, { seed = 1, clear = true } = {}) {
  await api.reset({ seed });
  await api.call("startGame");
  if (clear) await api.call("clearField");
}

/**
 * Begin a chosen stage's live wave. `clear` (default true) empties the auto-built
 * wave; pass `false` to keep the real wave (for entrance / challenge / escort
 * checks that read the real formation).
 */
export async function startStageClean(
  api,
  stage,
  { seed = 1, clear = true } = {},
) {
  await api.reset({ seed });
  await api.call("startStage", stage);
  if (clear) await api.call("clearField");
}

// ---- Field reads (pure; either phase) --------------------------------------

export function findDrone(snap, id) {
  return snap.drones.find((d) => d.id === id) ?? null;
}

export function enemyBullets(snap) {
  return snap.bullets.filter((b) => !b.friendly);
}

export function friendlyBullets(snap) {
  return snap.bullets.filter((b) => b.friendly);
}

// ---- Posing helpers (preconditions only; either phase) ----------------------
//
// These are control ops, so they consume no time and never touch the step clock:
// callable from `arrange`, and equally from `act` when a scenario has to be
// re-posed part-way through the filmed phase.

/** Spawn one drone through the real drone construction and return its id. */
export async function spawnDrone(api, spec) {
  return api.call("spawnDrone", spec);
}

/**
 * Fire a player bullet placed on a drone's CURRENT center — a precondition; the
 * real collision then decides destroy / mismatch. Reading the drone's position to
 * aim the shot is setup, not the observed outcome. Returns whether the drone was
 * found to aim at.
 */
export async function shootDrone(api, id, band) {
  const d = findDrone(await api.snapshot(), id);
  if (!d) return false;
  await api.call("spawnPlayerBullet", { x: d.x, y: d.y, band });
  return true;
}

/**
 * Send an enemy bullet onto the ship — a precondition; the real dual-use shield
 * then decides absorb / hit. Placed on the ship's current center.
 */
export async function shieldBullet(api, band) {
  const s = (await api.snapshot()).ship;
  await api.call("spawnEnemyBullet", { x: s.x, y: SHIP_Y, band });
}

// ---- Input-driven helpers --------------------------------------------------
//
// These drive the game the way a player does — through injected keyboard input
// (window.__spectra keyDown/keyUp/press, see specs/instrumentation.md) — rather
// than posing the world with the control ops. Because they never call a control
// op, the game stays under normal keyboard control and the ship responds to held
// movement and fire keys, which is exactly what a controls check must confirm.
//
// Their arrange half is whatever the item poses first (typically `startClean`
// followed by `setShipX`), so there is no separate `arrangeX` for them.

/**
 * ACT half of a movement-key check: hold a movement key, let the real ship update
 * run for exactly `ticks`, and report the ship's horizontal displacement. The
 * verdict is read after exactly `ticks` of held input, so the measured
 * displacement is the same in both passes; the extra `tailTicks` are held
 * afterwards purely so the recorded clip shows the ship sliding for a readable
 * moment before the key is released (they cannot affect the returned `dx`, which
 * was already captured).
 *
 * Replaces the old `holdMoveX(api, code, seconds)`. Returns `{ before, after, dx }`.
 */
export async function actHoldMoveX(
  api,
  code,
  { ticks = 36, tailTicks = 60 } = {},
) {
  const before = (await api.snapshot()).ship.x;
  await api.call("keyDown", code);
  await api.advance(ticks); // 36 ticks = the old 0.3 s of measured motion
  const after = (await api.snapshot()).ship.x;
  await api.advance(tailTicks); // 60 ticks (0.5 s) of visible travel for the clip
  await api.call("keyUp", code);
  return { before, after, dx: after - before };
}

/**
 * ACT half of a "hold a key and then look" check: hold `code` for exactly `ticks`,
 * read the snapshot while it is STILL HELD, then release. Used where the fact
 * under test is the state a sustained hold arrives at — the ship pinned against a
 * lane bound, for instance — rather than a displacement.
 *
 * Returns the snapshot taken before the release.
 */
export async function actHoldKey(api, code, ticks) {
  await api.call("keyDown", code);
  await api.advance(ticks);
  const snap = await api.snapshot();
  await api.call("keyUp", code);
  return snap;
}

/**
 * ACT half of a "hold a key and watch" check: hold `code` and advance in `poll`-tick
 * chunks up to `ticks` total, calling `sample(snap, elapsedTicks)` after each chunk,
 * then release. Used by the firing checks, which must watch the friendly-bullet
 * count evolve rather than read a single end state — the cap check wants the
 * maximum ever live, the cadence check the instants two shots appear.
 *
 * `sample` may return `true` to stop early (the cadence check stops as soon as it
 * has both shots). Returns the elapsed tick count.
 */
export async function actHoldSample(
  api,
  code,
  { ticks, poll = TICK, sample } = {},
) {
  await api.call("keyDown", code);
  let elapsed = 0;
  while (elapsed < ticks) {
    await api.advance(poll);
    elapsed += poll;
    if (sample && (await sample(await api.snapshot(), elapsed)) === true) break;
  }
  await api.call("keyUp", code);
  return elapsed;
}

// ---- A live wave -----------------------------------------------------------

/**
 * ARRANGE half of a real-wave scenario: reset to a fresh seeded wave of `stage`,
 * keeping the wave the real code builds (no `clearField`), so the swarm flies in
 * and dives on its own.
 *
 * Pair with `actLiveWave`. Note this replaces only the SETUP half of the old
 * `liveWaveClip`; there is no longer a generic "here is the game running" tail,
 * because `act` must film the behavior the item actually checks.
 */
export async function arrangeLiveWave(api, { seed = 2, stage = 1 } = {}) {
  await api.reset({ seed });
  await api.call("startStage", stage);
}

/**
 * ACT half of a real-wave scenario: let the real wave run for `ticks` and return
 * the snapshot at the end.
 *
 * Pair with `arrangeLiveWave`.
 */
export async function actLiveWave(api, { ticks = 156 } = {}) {
  await api.advance(ticks); // 156 ticks = the old 1300 ms
  return api.snapshot();
}

// ---- Spectral inversion ----------------------------------------------------

/**
 * ARRANGE half of the inversion drive: a clean, seeded stage wave with an empty
 * field, ready for `actInversion` to pose Prisms into.
 *
 * Pair with `actInversion`.
 */
export async function arrangeInversion(api, { seed = 1, stage = 1 } = {}) {
  await startStageClean(api, stage, { seed });
}

/**
 * ACT half of the inversion drive: drive a Prism to the bottom of the field so it
 * triggers a REAL spectral inversion, and return the snapshot at the instant it
 * fires.
 *
 * Whether a given dive exits through the bottom (triggering the inversion) or
 * loops back before it is an RNG roll taken when the dive launches, so this
 * retries: each attempt clears the field, poses one Prism, forces a real dive, and
 * runs it forward — if the inversion turns on it succeeds, and if the drone loops
 * back (`returning`) without inverting the next attempt draws the next roll from
 * the same seeded generator. The old helper re-`reset` with a fresh seed per
 * attempt; the runtime forbids `reset` in `act` (it would take the clock back and
 * freeze the recording), and re-rolling from one generator is equivalent — each
 * attempt is a fresh draw — while keeping the whole drive inside the filmed phase.
 *
 * Returns `{ hit, snap, id }`, exactly as the old `driveInversion` did.
 */
export async function actInversion(api, { attempts = 20, max = 600 } = {}) {
  let snap = await api.snapshot();
  for (let i = 0; i < attempts; i += 1) {
    await api.call("clearField");
    const id = await api.call("spawnDrone", {
      kind: "prism",
      band: "cyan",
      shellBand: "cyan",
      x: 640,
      y: 200,
      phase: "formation",
    });
    await api.advance(6); // 6 ticks (0.05 s) to arm the dive systems
    await api.call("forceDive", id);
    // Run the dive: it either inverts (an exit dive to the bottom) or loops back.
    // Poll coarsely — the inversion lasts 5 s, so it need not be caught to the frame.
    const r = await api.until(
      (s) => {
        const d = findDrone(s, id);
        return s.inversionActive || (d !== null && d.phase === "returning");
      },
      { max, poll: 6 }, // 600 ticks = the old 5 s cap; poll 6 = the old 0.05 s chunk
    );
    snap = r.snap;
    if (snap.inversionActive) return { hit: true, snap, id };
  }
  return { hit: false, snap, id: null };
}

// ---- Color sampling (reads the rendered canvas, not a reported value) -------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas, so a logical
// field coordinate maps to a fraction by dividing by the field size. Spectra fits
// the 1280x720 stage uniformly to the canvas (main.ts), so (x/FIELD_W, y/FIELD_H)
// is the right fraction. Reading the rendered pixel means a build cannot pass by
// returning a color it does not draw.
//
// These consume no simulation time, but they must run in `act`, and the posed
// scene must have been given a frame to paint first — `await api.settle(80)` — or
// the sample races the renderer. In the validate pass `advance` is instant and
// produces no frame at all, so `settle` (a REAL pause in both passes) is the only
// thing that guarantees one. See `api.settle` in validation.mjs.

/** Euclidean distance between two RGB colors (0 to ~441). */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * Average the rendered color over a small 5-point cluster (center + four neighbors
 * a few px out), so a stray antialiased pixel cannot swing the reading. Returns
 * `{ r, g, b }` (0–255).
 */
export async function sampleColor(api, x, y) {
  const offsets = [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
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

/**
 * Sample a grid across a logical box and return the BRIGHTEST painted pixel
 * (max r+g+b) in it. Used to read the color of a small drawn element (a drone with
 * its glyph and glow, the polarity swatch/label) without knowing its exact
 * sub-pixel position — whatever colored pixels the build painted in the region are
 * found, ignoring the dark field around them.
 */
export async function sampleVivid(api, x0, y0, x1, y1, nx = 9, ny = 9) {
  let best = { r: 0, g: 0, b: 0 };
  let bestLuma = -1;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const x = nx === 1 ? x0 : x0 + ((x1 - x0) * i) / (nx - 1);
      const y = ny === 1 ? y0 : y0 + ((y1 - y0) * j) / (ny - 1);
      const p = await api.pixel(x / FIELD_W, y / FIELD_H);
      const luma = p.r + p.g + p.b;
      if (luma > bestLuma) {
        bestLuma = luma;
        best = { r: p.r, g: p.g, b: p.b };
      }
    }
  }
  return best;
}

/**
 * Sample a grid across a logical box and return the MOST SATURATED painted pixel
 * (highest chroma among pixels bright enough to matter). Used to read the BAND
 * color of an element that carries a neutral hull the eye ignores — the ship,
 * whose white fuselage is its brightest pixel but whose band is told by its tinted
 * accents and glyph. `sampleVivid` (brightest) would lock onto the unchanging hull;
 * this reads the colored part that actually swaps with the band.
 */
export async function sampleSaturated(api, x0, y0, x1, y1, nx = 9, ny = 9) {
  let best = { r: 0, g: 0, b: 0 };
  let bestSat = -1;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const x = nx === 1 ? x0 : x0 + ((x1 - x0) * i) / (nx - 1);
      const y = ny === 1 ? y0 : y0 + ((y1 - y0) * j) / (ny - 1);
      const p = await api.pixel(x / FIELD_W, y / FIELD_H);
      const max = Math.max(p.r, p.g, p.b);
      if (max < 40) continue; // too dark to carry a hue
      const sat = (max - Math.min(p.r, p.g, p.b)) / max;
      if (sat > bestSat) {
        bestSat = sat;
        best = { r: p.r, g: p.g, b: p.b };
      }
    }
  }
  return best;
}

/**
 * Average the rendered color over a grid across a logical box. Used where the
 * element is drawn across a region (a drone with its glow, the HUD indicator) so
 * exact sub-pixel placement never matters — the region's mean color is read.
 */
export async function sampleBox(api, x0, y0, x1, y1, nx = 5, ny = 5) {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const x = nx === 1 ? x0 : x0 + ((x1 - x0) * i) / (nx - 1);
      const y = ny === 1 ? y0 : y0 + ((y1 - y0) * j) / (ny - 1);
      const p = await api.pixel(x / FIELD_W, y / FIELD_H);
      r += p.r;
      g += p.g;
      b += p.b;
      count += 1;
    }
  }
  return { r: r / count, g: g / count, b: b / count };
}
