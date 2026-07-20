// Case-specific helpers for Locomotivation's automated-validation debug scripts.
//
// Every script drives the real, deterministic simulation through window.__loco (see
// specs/instrumentation.md): control ops only set up PRECONDITIONS, then `step` runs
// the real movement/trains/cargo/collision/clock/win-fail code forward and `snapshot`
// (or the rendered canvas via `pixel`) reads the outcome back. Nothing fabricates a
// result. Because `reset()`/`step()` put the sim on the driver's clock (autoStep off),
// a stepped scenario advances EXACTLY the time asked, so measurements assert exact
// values with only tight float tolerances — no load slack. A motion video clip flips
// the game live (`setAutoStep(true)`) before a real-time `wait` so the clip moves.
//
// The assertion primitives are the reporter-side `ttc` kit the driver hands every
// `drive(api, ttc)` (packages/browser-driver/ttc.mjs); this file holds only what is
// specific to Locomotivation, mirrored from the spec / constants.

// ─── Stage & grid geometry (specs/overview.md, specs/world.md) ────────────────
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const STATUS_BAR_H = 80;
export const VIEW_Y = STATUS_BAR_H; // yard viewport top
export const VIEW_W = 1280;
export const VIEW_H = STAGE_H - STATUS_BAR_H; // 640
export const TILE = 40;

/** Tile (col,row) → center pixel, matching the sim's tileCenter. */
export const tileCenterX = (col) => col * TILE + TILE / 2;
export const tileCenterY = (row) => VIEW_Y + row * TILE + TILE / 2;

// ─── Simulation timestep (specs/controls.md) ──────────────────────────────────
export const DT = 1 / 60;

// ─── Worker movement / sprint / weight model (specs/character.md) ─────────────
export const V0 = 160; // base unladen speed, px/s
export const W_MAX = 120; // carry cap, capacity units
export const WEIGHT = { parcel: 30, crate: 55, load: 80 };
export const SPRINT_MULT = 1.6;
export const SPRINT_MAX = 1.6; // seconds of sprint at full charge
export const SPRINT_RECHARGE = 4.0; // empty→full seconds
export const SPRINT_LOCK_FRACTION = 0.8;

/** The base speed multiplier m(w) on the load fraction w (specs/character.md). */
export function speedMultiplier(w) {
  if (w <= 0.5) return 1.0;
  if (w <= 0.8) return 1.0 + ((w - 0.5) / 0.3) * (0.7 - 1.0);
  const t = Math.min(1, (w - 0.8) / 0.2);
  return 0.7 + t * (0.5 - 0.7);
}

/** The worker's expected speed for a carried load, walking or sprinting. */
export function expectedSpeed(load, sprinting = false) {
  const base = V0 * speedMultiplier(load / W_MAX);
  return sprinting ? base * SPRINT_MULT : base;
}

// ─── Trains (specs/trains.md) ─────────────────────────────────────────────────
export const TRAIN = {
  freight: { speed: 90, length: 480 },
  commuter: { speed: 190, length: 200 },
  bullet: { speed: 380, length: 120 },
};
export const TRAIN_HALF_BAND = 18;
export const NEAR_MISS_MARGIN = 10;

// ─── Scoring (specs/flow.md) ──────────────────────────────────────────────────
export const SCORE = {
  required: 100,
  optional: 250,
  timePerSec: 20,
  livesEach: 500,
  nearMiss: 40,
  lastTrain: 3000,
};

// ─── Session helpers ──────────────────────────────────────────────────────────

/** Reset to the title (re-arms the manual clock) and enter a campaign level live. */
export async function startFresh(api, level) {
  await api.reset();
  await api.call("startLevel", level);
}

/** Give the sim a real render frame (rendering runs regardless of the clock). */
export async function settle(api, ms = 90) {
  await api.wait(ms);
}

/** Flip the game live and hold, so a video output captures on-screen motion. */
export async function liveClip(api, ms = 900) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
}

/**
 * Hold `codes` (a movement/sprint key set), step the REAL sim for `seconds` on the
 * manual clock, and report the worker before/after. The snapshot is read while the
 * keys are still held, so facing/speed reflect the held motion. Returns
 * `{ before, after, snap, dx, dy }` (worker deltas in px).
 */
export async function holdMeasure(api, codes, seconds) {
  const before = (await api.snapshot()).worker;
  for (const c of codes) await api.call("keyDown", c);
  await api.step(seconds);
  const snap = await api.snapshot();
  for (const c of codes) await api.call("keyUp", c);
  return { before, after: snap.worker, snap, dx: snap.worker.x - before.x, dy: snap.worker.y - before.y };
}

/** Press a one-shot key and run one real step so its edge (pickup/drop/interact) resolves. */
export async function pressStep(api, code, dt = DT) {
  await api.call("press", code);
  await api.step(dt);
}

/** Pose the worker on a tile through the real position the movement/collision systems read. */
export const setTile = (api, col, row, facing) =>
  api.call("setWorker", facing ? { col, row, facing } : { col, row });

/** Pose the worker at exact stage pixels. */
export const setPos = (api, x, y, facing) =>
  api.call("setWorker", facing ? { x, y, facing } : { x, y });

// ─── Cardinal-control check (input-driven; each holds a key and reads the step) ─
const MOVE_MIN = 20; // a clearly non-trivial displacement over the measured hold, px

/**
 * Confirm every key in `keys` drives the worker along `axis` in `sign`'s direction and
 * turns it to `facing`. Poses the worker fresh before each key so the measurements are
 * independent. Records into `check`.
 */
export async function directionCheck(api, check, { level = 1, tile = { col: 8, row: 10 }, keys, axis, sign, facing }) {
  await startFresh(api, level);
  for (const code of keys) {
    await setTile(api, tile.col, tile.row);
    const r = await holdMeasure(api, [code], 0.35);
    const d = axis === "x" ? r.dx : r.dy;
    if (sign < 0) check.expectLt(`holding ${code} moves the worker ${facing} (Δ${axis})`, d, -MOVE_MIN);
    else check.expectGt(`holding ${code} moves the worker ${facing} (Δ${axis})`, d, MOVE_MIN);
    check.expectEq(`holding ${code} faces the worker ${facing}`, r.snap.worker.facing, facing);
  }
}

/** A live motion clip: pose, hold one key, run live, release. */
export async function directionClip(api, { tile = { col: 8, row: 10 }, code, ms = 800 }) {
  await setTile(api, tile.col, tile.row);
  await api.call("keyDown", code);
  await liveClip(api, ms);
  await api.call("keyUp", code);
}

// ─── Quota preconditioning ────────────────────────────────────────────────────

/**
 * Pre-satisfy a level's required quota as a PRECONDITION (delivered counts + unique
 * flags), then run one real step so the quota-satisfied latch resolves through the real
 * rule. On a level with a last train this latches `quotaMet` without winning; on a level
 * without one it would win, so use only where intended.
 */
export async function primeQuota(api, { delivered = {}, uniques = [] }) {
  for (const [color, count] of Object.entries(delivered)) await api.call("setDelivered", color, count);
  for (const id of uniques) await api.call("markUnique", id, true);
  await api.step(DT);
}

// ─── Color sampling (reads the rendered canvas, not a reported value) ──────────
//
// api.pixel(u, v) samples the largest canvas at fractions across it. At the driver's
// 1280x720 viewport the stage fills the canvas 1:1, so a logical (x, y) maps to
// (x/STAGE_W, y/STAGE_H) — the same direct mapping Carom uses.

/** Sample the rendered color, averaged over a small cluster so a stray edge pixel cannot swing it. */
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
    const p = await api.pixel((x + dx) / STAGE_W, (y + dy) / STAGE_H);
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

// ─── Snapshot readers ─────────────────────────────────────────────────────────

/** Delivered count for a color, from the quota snapshot (0 if the color is not required). */
export function deliveredOf(snap, color) {
  const q = (snap.quota || []).find((e) => e.color === color);
  return q ? q.delivered : 0;
}

/** The trains in the snapshot on a given trackId. */
export const trainsOn = (snap, trackId) => (snap.trains || []).filter((t) => t.trackId === trackId);

/** The single last-train (isLast) in the snapshot, if any. */
export const lastTrain = (snap) => (snap.trains || []).find((t) => t.isLast);
