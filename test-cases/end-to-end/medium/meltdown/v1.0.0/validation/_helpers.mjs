// Case-specific helpers for Meltdown's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__meltdown (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS (start a game, pose money/heat, build towers, spawn surge), then
// `step` runs the real firing, heat, cooling, conduction, pathing, movement, and
// scoring forward and `snapshot`/`pixel` read the outcome back. Nothing here
// fabricates a result. These helpers factor out the "arrange, step the real sim,
// read what happened" patterns and the floor geometry the scripts depend on
// (mirrored from specs/reactor.md and the canonical constants).
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit the
// driver hands every `drive(api, ttc)` (packages/browser-driver/ttc.mjs). This file
// holds only what is specific to Meltdown.

// ---- Floor + grid geometry (specs/reactor.md, constants.ts) ----------------
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const TILE = 19;
export const FLOOR_X0 = 18;
export const FLOOR_Y0 = 18;
export const COLS = 50;
export const ROWS = 36;
export const FLOOR_X1 = FLOOR_X0 + COLS * TILE; // 968 — right floor edge
export const FLOOR_Y1 = FLOOR_Y0 + ROWS * TILE; // 702 — bottom floor edge
export const FIXED = 1 / 60; // fixed-timestep (matches FIXED_STEP)
export const REDLINE = 100; // the universal trip threshold (constants.REDLINE)

// The four casing openings, as their floor-edge tile rows/cols.
export const LEFT_VENT_ROWS = [16, 17, 18, 19];
export const TOP_VENT_COLS = [22, 23, 24, 25, 26, 27, 28, 29];

// The eight shop tower types in hotkey/shop order (Digit1..8; specs/controls.md).
export const TOWER_ORDER = ["arc", "stutter", "lance", "bloom", "rime", "flak", "forge", "sink"];

// The tower footprint size (in tiles) per type, from specs/towers.md.
export const TOWER_SIZE = { arc: 2, stutter: 2, lance: 4, bloom: 3, rime: 2, flak: 2, forge: 2, sink: 2 };

// A tower footprint's center in logical pixels (matches Tower.cx/cy).
export function fpCenter(col, row, size) {
  return { x: FLOOR_X0 + (col + size / 2) * TILE, y: FLOOR_Y0 + (row + size / 2) * TILE };
}

// A tile center in logical pixels (specs/instrumentation.md).
export function tileCenter(col, row) {
  return { x: FLOOR_X0 + col * TILE + TILE / 2, y: FLOOR_Y0 + row * TILE + TILE / 2 };
}

// ---- Core drive helpers ----------------------------------------------------

/** A fresh match on the untimed opening build phase, with money posed if given. */
export async function newGame(api, mode = "containment", difficulty = "medium", money) {
  await api.reset();
  await api.call("startGame", mode, difficulty);
  if (money !== undefined) await api.call("setMoney", money);
  return api.snapshot();
}

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

export async function tower(api, id) {
  return (await api.snapshot()).towers.find((t) => t.id === id) ?? null;
}
export async function unit(api, id) {
  return (await api.snapshot()).surge.find((u) => u.id === id) ?? null;
}
export async function heatOf(api, id) {
  const t = await tower(api, id);
  return t ? t.heat : NaN;
}

/**
 * Build a tower through the real placement code and return the placed tower's id
 * (the newest tower whose footprint top-left and type match), or null if the
 * placement was refused. Routes through canPlaceAt, so an invalid placement builds
 * nothing and returns null.
 */
export async function build(api, type, col, row, rot = 0) {
  await api.call("placeTower", type, col, row, rot);
  const matches = (await api.snapshot()).towers.filter(
    (t) => t.type === type && t.col === col && t.row === row,
  );
  if (matches.length === 0) return null;
  return matches.reduce((a, b) => (b.id > a.id ? b : a)).id;
}

export async function spawn(api, type, vent = "left") {
  return api.call("spawnUnit", type, vent);
}

// ---- Input (through the real key handling) ---------------------------------
export async function press(api, code) {
  await api.call("press", code);
}

// ---- Live motion clip ------------------------------------------------------
//
// For a VIDEO output: hand the clock back to the animation loop with
// setAutoStep(true) and let real wall-clock time pass, so the recorded webm shows
// the posed scenario playing out (specs/instrumentation.md). The measurement that
// backs the verdict is always done first, in manual mode, with exact steps.
export async function liveClip(api, ms = 1600) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
}

// ---- Pixel / color sampling (reads the rendered canvas) --------------------
//
// Color checks read the pixels the build actually PAINTS, through api.pixel(u, v)
// (u, v are fractions across the largest canvas). A logical stage coordinate maps
// to a fraction by dividing by the stage size, so a script never needs the canvas's
// device dimensions. Reading the rendered pixel (not a value the game reports)
// means a build cannot pass by claiming a color it does not draw.
export function uv(x, y) {
  return [x / STAGE_W, y / STAGE_H];
}
export async function pixelAt(api, x, y) {
  const [u, v] = uv(x, y);
  return api.pixel(u, v);
}

/**
 * Sample the solid body color of a tower at an interior point offset up-and-left
 * of its center, clear of the central glyph and the bottom heat-read bar, averaged
 * over a small cluster so a stray antialiased pixel cannot swing the reading.
 */
export async function sampleTowerBody(api, t) {
  const s = t.size * TILE;
  const c = fpCenter(t.col, t.row, t.size);
  const px = c.x - s * 0.3;
  const py = c.y - s * 0.3;
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
    const p = await pixelAt(api, px + dx, py + dy);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = offsets.length;
  return { r: r / n, g: g / n, b: b / n };
}

export function colorDist(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

// ---- Combat scenario helpers ----------------------------------------------
//
// A standard "sustained target" layout: an emitter placed just BELOW the left
// vent lane (rows 16..19) so it does not block the lane, with a slow, tanky Core
// spawned at the left vent walking straight through its range. `setHeat` is used as
// a documented precondition to reproduce a thermal starting point; the real firing
// / heat / trip systems act on it from the next step, so the outcome a check reads
// (a trip, a kill, a slow) is still the game's own.

/**
 * Place `type` at (col,row) below the left lane and spawn a Core walking through
 * its range so the emitter has a real target to fire at. Returns { id, coreId }.
 */
export async function combatSetup(api, type, col = 3, row = 20, rot = 0) {
  const id = await build(api, type, col, row, rot);
  const coreId = await spawn(api, "core", "left");
  return { id, coreId };
}
