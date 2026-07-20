// Case-specific helpers for Spectra's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__spectra (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then `step` runs the real systems forward and `snapshot` reads
// the outcome back. Nothing fabricates a result. These helpers factor out the
// common "pose a scenario, step the real sim, read what happened" patterns and
// the field geometry the scripts depend on (mirrored from the spec / constants).
//
// Spectra uses the MANUAL STEP CLOCK (specs/instrumentation.md): reset() and
// step() put the sim under the driver's clock (autoStep off), so a stepped
// scenario advances by EXACTLY the seconds passed and measurements are exact. A
// video clip that should show motion must hand the clock back with
// setAutoStep(true) before a real `wait` — see `clip` below — because while
// autoStep is off the game renders every frame but does not advance.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit the driver hands every `drive(api, ttc)` (see
// `packages/browser-driver/ttc.mjs`), the single source of truth shared by every
// case. This file holds only what is specific to Spectra.

// ---- Geometry & constants (from specs + the canonical constants) -----------
export const FIELD_W = 1280;
export const FIELD_H = 720;
export const FIXED = 1 / 120; // physics timestep (matches FIXED_STEP)

export const SHIP_Y = 600; // fixed ship lane center y
export const SHIP_MIN_X = 40;
export const SHIP_MAX_X = 1240;
export const SHIP_SPEED = 360; // px/s while a direction is held

export const FIRE_CADENCE = 0.16; // seconds between shots
export const PBULLET_CAP = 3; // max player bullets alive
export const FLIP_LOCKOUT = 0.3; // post-flip fire lockout

export const RES_ABSORB = 6; // resonance per absorbed same-band bullet
export const RES_KILL = 4; // resonance per matching kill
export const RES_MAX = 100;

export const SWAY_AMP = 20; // formation sway amplitude, px
export const SWAY_PERIOD = 5; // formation sway period, seconds
export const SWAY_PEAK_T = 1.25; // waveTime of the +amplitude peak
export const SWAY_TROUGH_T = 3.75; // waveTime of the -amplitude trough

export const DIVE_SPEED = 300; // stage-1 dive speed, px/s
export const PRISM_INVERT_Y = 640; // a diving Prism crossing this inverts the field
export const EXTRA_LIFE_AT = 20000;
export const READY_HOLD = 1.3; // seconds of READY hold after a hit

// ---- Stepping --------------------------------------------------------------

/**
 * Advance the real simulation in fixed-step chunks until `predicate(snapshot)`
 * holds, or until `maxSeconds` of game time elapse. Returns the last snapshot and
 * whether the predicate was met. Pass a small `chunk` (FIXED) when you must read
 * state the instant something happens, or a coarser value for a cheap sweep.
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
export async function startStageClean(api, stage, { seed = 1, clear = true } = {}) {
  await api.reset({ seed });
  await api.call("startStage", stage);
  if (clear) await api.call("clearField");
}

// ---- Field reads -----------------------------------------------------------

export function findDrone(snap, id) {
  return snap.drones.find((d) => d.id === id) ?? null;
}

export function enemyBullets(snap) {
  return snap.bullets.filter((b) => !b.friendly);
}

export function friendlyBullets(snap) {
  return snap.bullets.filter((b) => b.friendly);
}

// ---- Posing helpers (preconditions only) -----------------------------------

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

/**
 * Hold a movement key, step the real sim deterministically, then release, and
 * report the ship's horizontal displacement. Because the sim advances by exactly
 * `seconds`, the displacement is exact.
 */
export async function holdMoveX(api, code, seconds = 0.3) {
  const before = (await api.snapshot()).ship.x;
  await api.call("keyDown", code);
  await api.step(seconds);
  const after = (await api.snapshot()).ship.x;
  await api.call("keyUp", code);
  return { before, after, dx: after - before };
}

// ---- Live motion clip ------------------------------------------------------

/**
 * Hand the step clock back to the game and let real wall-clock time pass, so the
 * recorded video output shows the posed scene actually animating (while autoStep
 * is off, the game renders every frame but does not advance — specs/instrumentation.md).
 * Returns the sim to the manual clock afterwards.
 */
export async function clip(api, ms = 1400) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
  await api.call("setAutoStep", false);
}

/**
 * A generic live clip: reset to a fresh real wave and let it play in real time so
 * the recorded video shows the swarm flying in and diving. Used where a specific
 * posed clip would add little over "here is the game running".
 */
export async function liveWaveClip(api, { seed = 2, stage = 1, ms = 1300 } = {}) {
  await api.reset({ seed });
  await api.call("startStage", stage);
  await clip(api, ms);
}

// ---- Spectral inversion ----------------------------------------------------

/**
 * Drive a Prism to the bottom of the field so it triggers a real spectral
 * inversion, and return the snapshot at the instant it fires. Whether a given
 * dive exits through the bottom (triggering the inversion) or loops back before it
 * depends on the seeded RNG, so this sweeps seeds until one produces an exit dive
 * that inverts. Each attempt poses one Prism, forces a real dive, and steps it
 * forward: if the inversion turns on, it succeeds; if the drone loops back
 * (returning) without inverting, the next seed is tried. Returns
 * `{ hit, snap, id }`.
 */
export async function driveInversion(api, { maxSeeds = 60, stage = 1 } = {}) {
  for (let seed = 1; seed <= maxSeeds; seed += 1) {
    await api.reset({ seed });
    await api.call("startStage", stage);
    await api.call("clearField");
    const id = await api.call("spawnDrone", {
      kind: "prism",
      band: "cyan",
      shellBand: "cyan",
      x: 640,
      y: 200,
      phase: "formation",
    });
    await api.step(0.05); // arm the dive systems
    await api.call("forceDive", id);
    // Run the dive: it either inverts (exit dive to the bottom) or loops back.
    const r = await stepUntil(
      api,
      (s) => {
        const d = findDrone(s, id);
        return s.inversionActive || (d !== null && d.phase === "returning");
      },
      5,
      0.05, // coarse sweep: the inversion lasts 5s, so it need not be caught to the frame
    );
    if (r.snap.inversionActive) return { hit: true, snap: r.snap, id };
  }
  return { hit: false, snap: await api.snapshot(), id: null };
}

// ---- Color sampling (reads the rendered canvas, not a reported value) -------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas, so a logical
// field coordinate maps to a fraction by dividing by the field size. Spectra fits
// the 1280x720 stage uniformly to the canvas (main.ts), so (x/FIELD_W, y/FIELD_H)
// is the right fraction. Reading the rendered pixel means a build cannot pass by
// returning a color it does not draw.

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
 * Average the rendered color over a grid across a logical box. Used where the
 * element is drawn across a region (a drone with its glow, the HUD indicator) so
 * exact sub-pixel placement never matters — the region's dominant color is read.
 */
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
