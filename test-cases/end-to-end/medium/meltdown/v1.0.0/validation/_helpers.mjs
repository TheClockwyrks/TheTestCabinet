// Case-specific helpers for Meltdown's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__meltdown (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS (start a game, pose money/heat, build towers, spawn surge), then
// time runs the real firing, heat, cooling, conduction, pathing, movement, and
// scoring forward and `snapshot`/`pixel` read the outcome back. Nothing here
// fabricates a result. These helpers factor out the "arrange, run the real sim,
// read what happened" patterns and the floor geometry the scripts depend on
// (mirrored from specs/reactor.md and the canonical constants).
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
// A helper that only poses state or reads it instantly (`newGame`, `restartGame`,
// `build`, `spawn`, `tower`, `unit`, `heatOf`, `press`, `combatSetup`) is unpaired:
// it is arrange-callable on its own, and the instant READS are callable from any
// phase. `restartGame` is additionally act-safe — see its note.
//
// UNITS ARE TICKS. Meltdown is a 60 Hz fixed timestep and the debug API's `step`
// takes whole ticks, so every duration below is a tick count (the runtime converts
// to wall-clock for the record pass). The seconds these replace are noted inline.
// The exception is anything the GAME measures in seconds — `setBuildTimer`, a
// snapshot's `buildTimer`/`tripTimer`/`simTime` — which are game-facing quantities
// and stay in seconds.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit
// (packages/browser-driver/ttc.mjs), the single source of truth shared by every
// case. This file holds only what is specific to Meltdown.

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
export const REDLINE = 100; // the universal trip threshold (constants.REDLINE)

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed simulation step (this replaces the old `FIXED = 1/60` seconds constant);
// pass `poll: TICK` to `api.until` when the exact instant of an event matters.
export const TICK_HZ = 60;
export const TICK = 1;

/**
 * Seconds expressed as an exact whole number of 60 Hz ticks, for the handful of
 * durations a script states in the game's own units (a trip cooldown, a build
 * timer) and then has to advance past. Throws rather than rounding, matching the
 * debug API's own refusal to guess at a fractional step count — if a duration is
 * not a whole number of ticks, the script must decide deliberately what it meant.
 */
export function ticks(seconds) {
  const n = seconds * TICK_HZ;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `ticks(${seconds}): not a whole non-negative number of ${TICK_HZ} Hz ticks`,
    );
  }
  return n;
}

// The four casing openings, as their floor-edge tile rows/cols.
export const LEFT_VENT_ROWS = [16, 17, 18, 19];
export const TOP_VENT_COLS = [22, 23, 24, 25, 26, 27, 28, 29];

// The eight shop tower types in hotkey/shop order (Digit1..8; specs/controls.md).
export const TOWER_ORDER = [
  "arc",
  "stutter",
  "lance",
  "bloom",
  "rime",
  "flak",
  "forge",
  "sink",
];

// The tower footprint size (in tiles) per type, from specs/towers.md.
export const TOWER_SIZE = {
  arc: 2,
  stutter: 2,
  lance: 4,
  bloom: 3,
  rime: 2,
  flak: 2,
  forge: 2,
  sink: 2,
};

// A tower footprint's center in logical pixels (matches Tower.cx/cy).
export function fpCenter(col, row, size) {
  return {
    x: FLOOR_X0 + (col + size / 2) * TILE,
    y: FLOOR_Y0 + (row + size / 2) * TILE,
  };
}

// A tile center in logical pixels (specs/instrumentation.md).
export function tileCenter(col, row) {
  return {
    x: FLOOR_X0 + col * TILE + TILE / 2,
    y: FLOOR_Y0 + row * TILE + TILE / 2,
  };
}

// ---- State-only helpers (arrange) ------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * A fresh match on the untimed opening build phase, with money posed if given.
 *
 * ARRANGE ONLY — it calls `api.reset()`, which the runtime refuses from `act`
 * (reset hands the build back to its manual clock and would freeze the recording).
 * A script that needs a SECOND scenario partway through its drive wants
 * `restartGame` below.
 */
export async function newGame(
  api,
  mode = "containment",
  difficulty = "medium",
  money,
) {
  await api.reset();
  await api.call("startGame", mode, difficulty);
  if (money !== undefined) await api.call("setMoney", money);
  return api.snapshot();
}

/**
 * The same fresh match, WITHOUT the `reset()` — act-safe.
 *
 * This is what an A/B script uses to pose its second configuration mid-drive. The
 * comparison checks (cooling by rotation, Sink vs no Sink, Forge setpoint by level,
 * conduction, upgrade scaling) each run one layout forward, read it, then build the
 * other layout and run that forward, so their second setup lands in `act` — where
 * `reset()` throws. `startGame` alone is a complete re-pose: it rebuilds the match
 * from scratch (clearing towers, surge, money, lives, and the wave) through the same
 * real start path, and unlike `reset` it never touches the clock, so the recording
 * keeps running across the switch.
 *
 * Only the seed differs: `reset({ seed })` is the sole way to reseed. Meltdown's
 * base variant uses no randomness, so nothing here depends on that.
 */
export async function restartGame(
  api,
  mode = "containment",
  difficulty = "medium",
  money,
) {
  await api.call("startGame", mode, difficulty);
  if (money !== undefined) await api.call("setMoney", money);
  return api.snapshot();
}

// `stepUntil` is gone: the runtime's own `api.until(pred, { max, poll })` does the
// same sweep in both passes and returns `{ snap, hit, spent }`. Convert its two
// seconds arguments to ticks — a 10s cap is `max: 600`, the old default `FIXED`
// chunk is `poll: TICK`, an 0.1s chunk is `poll: 6`, an 0.2s chunk is `poll: 12`.

// ---- Instant reads (any phase) ---------------------------------------------
//
// Pure `snapshot` reads. They consume no time, so they are callable from `arrange`,
// `act`, and `assert` alike.

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

// `liveClip` is gone. It existed only to re-pose a scenario and film it in real
// time after the verdict had already been measured with exact steps. `act` IS the
// clip now: the runtime replays the same `act` in real time for the record pass, so
// an item films exactly the drive that decided its verdict. Delete every
// `liveClip(api, ms)` call rather than translating it — the timed work belongs in
// `act`, and `setAutoStep` is the runtime's to call, never an item's.

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

/**
 * ACT-phase read of a tower's painted body color: let a frame land, then sample.
 *
 * The settle is a REAL pause in both passes, not `advance`. These checks read the
 * pixels the build actually painted, which needs a frame to have been drawn since
 * the heat/trip state was posed — and in the validate pass `advance` is instant, so
 * it produces no frame at all. This replaces the old `await api.wait(90)` that every
 * pixel script did by hand before calling `sampleTowerBody`. See `api.settle` in
 * validation.mjs.
 *
 * Returns `{ r, g, b }` (0–255), or null if the tower is gone.
 */
export async function actSampleTowerBody(api, id, { settleMs = 90 } = {}) {
  await api.settle(settleMs);
  const t = await tower(api, id);
  return t ? sampleTowerBody(api, t) : null;
}

// ---- Trip scenarios --------------------------------------------------------
//
// The trip checks all pose an emitter near its redline, give it a real target, and
// let the REAL firing/heat systems carry it over 100 — the trip is the game's own,
// never posed. `arrangeNearRedline` is the shared arrange half; the act halves below
// run the real sim to the trip (and, for the cooldown check, back out of it).

/**
 * ARRANGE half of a trip scenario: build `type` below the left lane, spawn a Core
 * walking through its range, and pose the emitter's heat just under the redline so
 * a few steps of real firing carry it over. Lives are posed high so a leak during
 * the drive cannot end the run out from under the check.
 *
 * Pair with `actUntilTripped` / `actTripAndRecover`. Returns `{ id, coreId }`.
 */
export async function arrangeNearRedline(
  api,
  type,
  { heat = 92, col = 3, row = 20, rot = 0 } = {},
) {
  await api.call("setLives", 100000);
  const c = await combatSetup(api, type, col, row, rot);
  await api.call("setHeat", c.id, heat);
  return c;
}

/**
 * ACT half of a trip scenario: run the real sim until the emitter trips, and return
 * the tower's state at that instant. Polls one tick at a time — the exact step the
 * redline is crossed on is what the check reads.
 *
 * Pair with `arrangeNearRedline`. Returns `{ hit, snap, t }` where `t` is the
 * tripped tower (or null).
 */
export async function actUntilTripped(
  api,
  id,
  { max = 360, poll = TICK } = {},
) {
  // 360 ticks = the old 6s cap.
  const r = await api.until(
    (s) => s.towers.some((t) => t.id === id && t.tripped),
    { max, poll },
  );
  return {
    hit: r.hit,
    snap: r.snap,
    t: r.snap.towers.find((t) => t.id === id) ?? null,
  };
}

/**
 * ACT half of the trip-cooldown scenario: run the real sim to the trip, then keep
 * running until the emitter comes back online, and report both. A tripped tower is
 * meant to return COLD, so the caller reads `back.t.heat` as well as its online flag.
 *
 * Pair with `arrangeNearRedline`. Returns `{ tripped, back }`, each the shape
 * `actUntilTripped` returns.
 */
export async function actTripAndRecover(
  api,
  id,
  { tripMax = 360, backMax = 420 } = {},
) {
  // 360 ticks = the old 6s trip cap; 420 ticks = the old 7s recovery cap.
  const tripped = await actUntilTripped(api, id, { max: tripMax });
  const r = await api.until(
    (s) => s.towers.some((t) => t.id === id && !t.tripped),
    {
      max: backMax,
      poll: TICK,
    },
  );
  return {
    tripped,
    back: {
      hit: r.hit,
      snap: r.snap,
      t: r.snap.towers.find((t) => t.id === id) ?? null,
    },
  };
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
