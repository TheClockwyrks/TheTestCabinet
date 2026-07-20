// Case-specific helpers for Locomotivation's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through window.__loco
// (see specs/instrumentation.md): control ops only set up PRECONDITIONS, then time
// runs the real movement/trains/cargo/collision/clock/win-fail code forward and
// `snapshot` (or the rendered canvas via `pixel`) reads the outcome back. Nothing
// fabricates a result.
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
//     the outcome the assertions read. Callable from `act`, and the only part filmed.
//   * `assertX(check, outcome, ...)` — records the assertion(s) into the item's
//     `check`. Validate pass only.
//
// A helper that only poses state (`startFresh`, `setTile`, `setPos`) is unpaired: it
// is arrange-callable on its own. Everything that consumes time comes in an
// `arrangeX` / `actX` PAIR, named for the same scenario, and the two halves must be
// used together — the act half assumes its arrange half posed the world.
//
// UNITS ARE TICKS. Locomotivation is a 60 Hz fixed timestep and the debug API's
// `step` takes whole ticks, so every duration below is a tick count (the runtime
// converts to wall-clock for the record pass). The seconds these replace are noted
// inline. Times a caller POSES or READS — the shift clock, `simTime`, sprint charge —
// are still in seconds; only advancing time is counted in ticks.
//
// There is no `liveClip` helper any more: `act` IS the clip. The old real-time clip
// tails re-posed a scenario and waited with the game running, which is exactly what
// the record pass now does with `act` itself.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit
// (`packages/browser-driver/ttc.mjs`), shared by every case. This file holds only
// what is specific to Locomotivation, mirrored from the spec / constants.

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
//
// One tick is one fixed simulation step. This replaces the old `DT = 1/60` seconds
// constant: the debug API's `step` now takes whole ticks, so a duration is a tick
// COUNT and there is nothing to round. Pass `poll: TICK` to `api.until` when the
// exact instant of an event matters.
export const TICK_HZ = 60;
export const TICK = 1;

/**
 * Convert a duration the specs state in SECONDS into ticks, refusing anything that
 * is not a whole number of them.
 *
 * The point of the tick contract is that a step count is exact, so a conversion that
 * does not land on a tick boundary is a decision for the author to make deliberately
 * (round which way, and why) rather than something a helper should silently floor.
 * Use this for durations derived from a spec constant — `ticksFor(SPRINT_RECHARGE)`
 * — and write the literal tick count inline, with a comment, where a scenario just
 * needs "a moment".
 */
export function ticksFor(seconds) {
  const t = seconds * TICK_HZ;
  // Guard against binary-float drift (0.35 * 60 = 20.999999999999996) before judging
  // whether the duration is really a whole number of ticks.
  const rounded = Math.round(t);
  if (Math.abs(t - rounded) > 1e-9) {
    throw new Error(
      `ticksFor(${seconds}): ${seconds}s is ${t} ticks at ${TICK_HZ} Hz, not a whole number — ` +
        `pick the tick count that preserves what the check probes and pass it directly`,
    );
  }
  return rounded;
}

// ─── Worker movement / sprint / weight model (specs/character.md) ─────────────
export const V0 = 160; // base unladen speed, px/s
export const W_MAX = 120; // carry cap, capacity units
export const WEIGHT = { parcel: 30, crate: 55, load: 80 };
export const SPRINT_MULT = 1.6;
export const SPRINT_MAX = 1.6; // seconds of sprint at full charge (96 ticks)
export const SPRINT_RECHARGE = 4.0; // empty→full seconds (240 ticks)
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

// ─── State-only helpers (arrange) ─────────────────────────────────────────────
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * Reset to the title (re-arms the manual clock) and enter a campaign level live.
 *
 * ARRANGE ONLY. It calls `api.reset()`, which the runtime forbids in `act` — a reset
 * mid-act would take the clock back and silently freeze the recording.
 */
export async function startFresh(api, level) {
  await api.reset();
  await api.call("startLevel", level);
}

/** Pose the worker on a tile through the real position the movement/collision systems read. */
export const setTile = (api, col, row, facing) =>
  api.call("setWorker", facing ? { col, row, facing } : { col, row });

/** Pose the worker at exact stage pixels. */
export const setPos = (api, x, y, facing) =>
  api.call("setWorker", facing ? { x, y, facing } : { x, y });

// ─── Timed primitives (act) ───────────────────────────────────────────────────

/**
 * ACT: hold `codes` (a movement/sprint key set), run the REAL sim for `ticks`, and
 * report the worker before/after. The snapshot is read while the keys are still held,
 * so facing/speed reflect the held motion; the keys are released afterwards.
 *
 * Replaces the old `holdMeasure(api, codes, seconds)` — the duration is now a tick
 * count. Returns `{ before, after, snap, dx, dy }` (worker deltas in px).
 */
export async function actHoldMeasure(api, codes, ticks) {
  const before = (await api.snapshot()).worker;
  for (const c of codes) await api.call("keyDown", c);
  await api.advance(ticks);
  const snap = await api.snapshot();
  for (const c of codes) await api.call("keyUp", c);
  return {
    before,
    after: snap.worker,
    snap,
    dx: snap.worker.x - before.x,
    dy: snap.worker.y - before.y,
  };
}

/**
 * ACT: press a one-shot key and advance `ticks` so its edge (pickup, drop, lever
 * throw) resolves through the real systems. One tick is enough for the edge itself;
 * pass more only when the scenario needs the consequence to play out too.
 *
 * Replaces the old `pressStep(api, code, dt = DT)`. Returns the snapshot after the
 * step, so a caller can read the result without a second round trip.
 */
export async function actPressStep(api, code, ticks = TICK) {
  await api.call("press", code);
  await api.advance(ticks);
  return api.snapshot();
}

// ─── Cardinal-control check (input-driven) ────────────────────────────────────
//
// The old `directionCheck` did all three jobs at once — it reset into a level, held
// each key for a measured stretch, and recorded the assertions — which no phase can
// do any more. It is split into the three halves below, and the old `directionClip`
// (a separate real-time tail that re-held one key) is gone: `actDirection` is what
// the record pass films, so the clip now shows the very motion that was measured.

const MOVE_MIN = 20; // a clearly non-trivial displacement over the measured hold, px

/** ARRANGE half of a cardinal-control check: enter a level live. Pair with `actDirection`. */
export async function arrangeDirection(api, { level = 1 } = {}) {
  await startFresh(api, level);
}

/**
 * ACT half of a cardinal-control check: hold each key in `keys` in turn and report
 * how the worker moved. The worker is re-posed on `tile` before each key (a control
 * op, so it is legal mid-act and does not touch the clock) so the measurements are
 * independent of one another.
 *
 * Pair with `arrangeDirection`. Returns an array of `{ code, r }`, one per key, where
 * `r` is what `actHoldMeasure` returned.
 */
export async function actDirection(
  api,
  { tile = { col: 8, row: 10 }, keys, ticks = 21 } = {},
) {
  // 21 ticks = the old 0.35s hold. 0.35s is 21 ticks exactly at 60 Hz.
  const results = [];
  for (const code of keys) {
    await setTile(api, tile.col, tile.row);
    results.push({ code, r: await actHoldMeasure(api, [code], ticks) });
  }
  return results;
}

/**
 * ASSERT half of a cardinal-control check: confirm every key drove the worker along
 * `axis` in `sign`'s direction and turned it to `facing`. `results` is what
 * `actDirection` returned. Records into `check`, one displacement assertion and one
 * facing assertion per key — the same two the old `directionCheck` recorded, with the
 * same label text — so a build that drops one key fails only that key's point.
 */
export function assertDirection(check, results, { axis, sign, facing }) {
  for (const { code, r } of results) {
    const d = axis === "x" ? r.dx : r.dy;
    if (sign < 0) {
      check.expectLt(`holding ${code} moves the worker ${facing} (Δ${axis})`, d, -MOVE_MIN);
    } else {
      check.expectGt(`holding ${code} moves the worker ${facing} (Δ${axis})`, d, MOVE_MIN);
    }
    check.expectEq(`holding ${code} faces the worker ${facing}`, r.snap.worker.facing, facing);
  }
}

// ─── Quota preconditioning ────────────────────────────────────────────────────
//
// The old `primeQuota` posed the counts AND ran the latching step. The setters are
// arrange work and the step is act work, so it splits in two.

/**
 * ARRANGE half of quota preconditioning: pre-satisfy a level's required quota as a
 * PRECONDITION (delivered counts + unique flags). This only poses the counters — the
 * quota-satisfied latch is a real rule that resolves on the next simulation step,
 * which is `actLatchQuota`'s job.
 *
 * Pair with `actLatchQuota`.
 */
export async function arrangePrimeQuota(api, { delivered = {}, uniques = [] } = {}) {
  for (const [color, count] of Object.entries(delivered)) {
    await api.call("setDelivered", color, count);
  }
  for (const id of uniques) await api.call("markUnique", id, true);
}

/**
 * ACT half of quota preconditioning: run one real step so the quota-satisfied latch
 * resolves through the real rule. On a level with a last train this latches
 * `quotaMet` without winning; on a level WITHOUT one it would win, so use only where
 * that is intended.
 *
 * Call this at the top of `act`, before the scenario proper, so the latch is settled
 * before the behavior under test runs. Pair with `arrangePrimeQuota`. Returns the
 * snapshot after the latch.
 */
export async function actLatchQuota(api) {
  await api.advance(TICK);
  return api.snapshot();
}

// ─── Color sampling (reads the rendered canvas, not a reported value) ──────────
//
// api.pixel(u, v) samples the largest canvas at fractions across it. At the driver's
// 1280x720 viewport the stage fills the canvas 1:1, so a logical (x, y) maps to
// (x/STAGE_W, y/STAGE_H) — the same direct mapping Carom uses.

/**
 * Sample the rendered color, averaged over a small cluster so a stray edge pixel
 * cannot swing it. Returns `{ r, g, b }` (0–255).
 *
 * A pure read of the canvas: it consumes no simulation time, but it must run in `act`
 * because it needs the posed scene to have PAINTED. Let a frame land first with
 * `api.settle(ms)` — a real pause in both passes, and the only correct way to wait
 * for paint (the old `settle(api, ms)` helper wrapped `api.wait`, which no longer
 * exists on the item api). `advance` will not do: in the validate pass it is instant
 * and produces no frame at all.
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
//
// Pure functions over a snapshot the caller already has: no api, no time, callable
// from any phase.

/** Delivered count for a color, from the quota snapshot (0 if the color is not required). */
export function deliveredOf(snap, color) {
  const q = (snap.quota || []).find((e) => e.color === color);
  return q ? q.delivered : 0;
}

/** The trains in the snapshot on a given trackId. */
export const trainsOn = (snap, trackId) => (snap.trains || []).filter((t) => t.trackId === trackId);

/** The single last-train (isLast) in the snapshot, if any. */
export const lastTrain = (snap) => (snap.trains || []).find((t) => t.isLast);
