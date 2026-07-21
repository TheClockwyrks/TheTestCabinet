// Case-specific helpers for Deepcore's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through window.__deepcore
// (see specs/instrumentation.md): control ops only ARRANGE preconditions, then time runs
// the real systems forward and `snapshot`/`tileAt`/`pixel` read the outcome back. Nothing
// fabricates a result.
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time instant
// to decide the verdict, once in real time to record the media — and the runtime enforces
// the split by throwing if `arrange` consumes time:
//
//   * `arrangeX(api, ...)` / the unpaired state-only helpers — control ops and instant
//     reads only. Callable from `arrange`, and they run in BOTH passes, so the record pass
//     reaches `act` in exactly the state the check saw.
//   * `actX(api, ...)` — consumes time via `api.advance` / `api.until` and returns the
//     outcome the assertions read. Callable from `act`, and the only part filmed.
//
// A helper that only poses state (`newRun`, `cleanTitle`, `solid`, `openColumn`,
// `standAt`, `bothNodes`) is unpaired: it is arrange-callable on its own. Everything that
// consumes time comes in an `arrangeX` / `actX` PAIR named for the same scenario, and the
// two halves must be used together — the act half assumes its arrange half posed the
// world.
//
// UNITS ARE TICKS. Deepcore is a 60 Hz fixed timestep (specs/controls.md) and the debug
// API's `step` takes whole ticks, so every duration below is a tick count: 1 tick = 1/60 s,
// so 60 ticks = 1 second (the runtime converts to wall-clock for the record pass). The
// seconds these replace are noted inline.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit the driver
// hands every item (packages/browser-driver/ttc.mjs), shared by every case. This file holds
// only what is specific to Deepcore.

// ---- Geometry & constants (specs/overview.md, specs/world.md, specs/controls.md) ----
export const TILE = 80;
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const VIEWPORT_Y = 56; // status bar height; the mine viewport starts here
export const MINER_W = 57;
export const MINER_H = 73;
export const SPAWN_COL = 15;

// The simulation rate, and the finest granularity a sweep can poll at. One tick is one
// fixed logic step (this replaces the old `TICK = 1/60` seconds constant); pass
// `poll: TICK` to `api.until` when the exact instant of an event matters. `TICK_HZ` doubles
// as the seconds->ticks factor: N seconds is `N * TICK_HZ` ticks.
export const TICK_HZ = 60;
export const TICK = 1;

// Representative interior rows of each band in the STANDARD mine (coreRow 500, quarters of
// 125 rows each: topsoil 1..125, rockbed 126..250, deepstone 251..375, coreshell 376..499).
export const TOPSOIL_ROW = 60;
export const ROCKBED_ROW = 190;
export const DEEPSTONE_ROW = 310;
export const CORESHELL_ROW = 440;

// Held-key codes for the four movement intents (specs/controls.md — arrows or WASD).
export const K = { down: "ArrowDown", thrust: "ArrowUp", left: "ArrowLeft", right: "ArrowRight" };

// ---- Run setup (arrange) ---------------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable straight
// from `arrange` and need no act half.

/** Reset to a fixed seed and start a fresh expedition; returns the opening snapshot. The seed
 *  fixes the generated mine so a scenario replays identically (specs/instrumentation.md). */
export async function newRun(api, { mode = "standard", size = "standard", seed = 1 } = {}) {
  await api.reset({ seed });
  await api.call("startExpedition", mode, size);
  return api.snapshot();
}

/** Return to a clean title with NO save present (startExpedition clears any save, then reset
 *  re-arms the title), so the main-menu order is deterministic (no stray CONTINUE entry). */
export async function cleanTitle(api) {
  await api.reset({ seed: 1 });
  await api.call("startExpedition", "standard");
  await api.reset({ seed: 1 });
}

// ---- Terrain arrangement (preconditions only) -----------------------------

/** Make one cell solid rock (its band is kept, so it drills at that band's hardness). */
export async function solid(api, col, row) {
  await api.call("setTile", col, row, { kind: "rock" });
}

/** Carve a vertical run of open tunnel over rows [rowFrom, rowTo] in a column, so the miner can
 *  climb or fall a long way through open space (a precondition for climb/fall measurements). */
export async function openColumn(api, col, rowFrom, rowTo) {
  const lo = Math.min(rowFrom, rowTo);
  const hi = Math.max(rowFrom, rowTo);
  for (let r = lo; r <= hi; r += 1) await api.call("setTile", col, r, { kind: "tunnel" });
}

/** Place the miner on a guaranteed solid floor at (col, row): teleport into the cell (carved to
 *  tunnel) and lay a rock tile directly beneath so it stands grounded rather than on whatever the
 *  seed happened to put there. */
export async function standAt(api, col, row) {
  await api.call("teleport", col, row);
  await solid(api, col, row + 1);
  await api.call("teleport", col, row); // re-settle onto the fresh floor
}

// ---- Key input -------------------------------------------------------------

/** Tap a key as a one-shot edge (menu move / confirm / activate), applied immediately. A press
 *  consumes no simulation time, so it is callable from either phase — from `arrange` to walk the
 *  menus into position, from `act` when the press itself is the behavior under test. */
export async function press(api, code) {
  await api.call("press", code);
}

// ---- Timed drives (act) ----------------------------------------------------

/**
 * ACT: advance the real sim by `ticks` and return the fresh snapshot. In the validate pass this
 * is an exact `step` on the manual clock, so the scenario advances by EXACTLY that many ticks;
 * in the record pass it is a real pause of the same duration while the build drives itself.
 *
 * Replaces the old seconds-based `step(api, seconds)` helper: `step(api, 0.25)` becomes
 * `actAdvance(api, 15)`.
 */
export async function actAdvance(api, ticks) {
  await api.advance(ticks);
  return api.snapshot();
}

/**
 * ACT: hold `code` down, advance the real sim `ticks` (the miner moves/drills under its own
 * update), and return the snapshot. Leaves the key held unless `release`.
 *
 * Replaces the old `holdFor(api, code, seconds, opts)`.
 */
export async function actHoldFor(api, code, ticks, { release = true } = {}) {
  await api.call("keyDown", code);
  await api.advance(ticks);
  const snap = await api.snapshot();
  if (release) await api.call("keyUp", code);
  return snap;
}

// The old `stepUntil(api, predicate, maxSeconds, chunk)` is GONE — the runtime provides it as
// `api.until(predicate, { max, poll })`, which returns `{ snap, hit, spent }` and works in both
// passes (stepping in validate, sampling the running game in record). Convert the bounds to
// ticks: the common `stepUntil(..., 3, 0.05)` becomes `api.until(..., { max: 180, poll: 3 })`.
//
// The old `liveClip(api, ms)` is GONE too. It re-armed live running with `setAutoStep(true)` and
// waited so a video showed motion; `act` IS the clip now, filmed in real time by the record pass,
// so an item must never touch `setAutoStep` and needs no clip tail.

// ---- Death (arrange + act pair) -------------------------------------------

/**
 * ARRANGE half of a hull death underground: stand the miner on a solid floor at (col, row) and
 * empty its hull. Nothing is faked — the death itself is produced by the REAL death path (hull
 * <= 0 in live play -> triggerDeath) when time runs forward.
 *
 * Pair with `actKillByHull`.
 */
export async function arrangeKillByHull(api, col, row) {
  await standAt(api, col, row);
  await api.call("setHull", 0);
}

/**
 * ACT half of a hull death: run the real simulation until the Game Over screen resolves and
 * return the end snapshot. Polls coarsely — nothing read here changes before the death lands.
 *
 * Pair with `arrangeKillByHull`. Returns the snapshot (what the old `killByHull` returned).
 */
export async function actKillByHull(api, { max = 180, poll = 6 } = {}) {
  // 180 ticks = the old 3s cap; poll 6 = the old 0.1s chunk.
  const r = await api.until((s) => s.screen === "game-over", { max, poll });
  return r.snap;
}

// ---- Material-node discovery (arrange) ------------------------------------

/**
 * Discover BOTH guaranteed buried material nodes of a freshly-generated mine and report each
 * one's material and band. findTile only locates the NEAREST material tile, so we read the
 * nearest, then teleport onto it (carving it away) so the second findTile returns the other
 * node. Consumes no time (reset, teleport, and the reads are all instant), so it is
 * arrange-callable. Returns `[{ material, band, col, row }, ...]` (0, 1, or 2 entries).
 */
export async function bothNodes(api, seed = 1) {
  await api.reset({ seed });
  await api.call("startExpedition", "standard", "standard");
  const out = [];
  const p1 = await api.call("findTile", "material");
  if (!p1) return out;
  const t1 = await api.call("tileAt", p1.col, p1.row);
  out.push({ material: t1.material, band: t1.band, col: p1.col, row: p1.row });
  await api.call("teleport", p1.col, p1.row); // carve the first node away
  const p2 = await api.call("findTile", "material");
  if (p2) {
    const t2 = await api.call("tileAt", p2.col, p2.row);
    out.push({ material: t2.material, band: t2.band, col: p2.col, row: p2.row });
  }
  return out;
}

// ---- Pixel / color sampling (reads the rendered canvas) --------------------
//
// pixel(u, v) samples the ACTUAL rendered largest canvas at a normalized point (see
// packages/browser-driver/driver.mjs). The mine is drawn with the camera offset
// (render.ts): a world point (wx, wy) lands at screen (wx - cameraX, VIEWPORT_Y + wy -
// cameraY) in the fixed 1280x720 logical stage, so a logical stage point maps to a canvas
// fraction by dividing by the stage size. Reading the drawn pixel (not a value the game
// reports) means a build cannot pass a color check by claiming a color it never paints.
//
// PHASE: the sampling helpers below (`sampleAt`, `sampleTile`, `tileMaxDistFrom`) consume no
// simulation time, but they must run in `act` — they need the posed scene to have PAINTED, and
// in the validate pass advancing time is instant and produces no frame at all. Call
// `await api.settle(120)` (a REAL pause in both passes, see `api.settle` in validation.mjs)
// once after the scene is posed, before the first sample. That settle replaces the old
// `api.wait(120)` these scripts used. `tileScreen`, `minerScreen`, and `colorDistance` are pure
// arithmetic and are callable from any phase.

/** Logical-stage coords of a tile's center for the given camera. */
export function tileScreen(col, row, cam) {
  return { x: col * TILE - cam.x + TILE / 2, y: VIEWPORT_Y + row * TILE - cam.y + TILE / 2 };
}

/** Logical-stage coords of the miner's center for the given camera. */
export function minerScreen(m, cam) {
  return { x: m.x + MINER_W / 2 - cam.x, y: VIEWPORT_Y + m.y + MINER_H / 2 - cam.y };
}

/** Average the rendered color over a small 5-point cluster around a logical stage point, so a
 *  stray antialiased edge pixel cannot swing the reading. Returns { r, g, b } (0–255). */
export async function sampleAt(api, x, y) {
  const offsets = [
    [0, 0],
    [7, 0],
    [-7, 0],
    [0, 7],
    [0, -7],
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

/** Sample a tile's rendered center color; reads the live camera itself. Act-phase — settle once
 *  with `api.settle` after posing the scene so there is a painted frame to read. */
export async function sampleTile(api, col, row) {
  const cam = (await api.snapshot()).camera;
  const s = tileScreen(col, row, cam);
  return sampleAt(api, s.x, s.y);
}

/** The greatest color distance from `ref` found across a 3x3 grid of points inside a tile — so
 *  a payload that covers only PART of the tile (an ore smear) still registers as present.
 *  Act-phase, like `sampleTile`. */
export async function tileMaxDistFrom(api, col, row, ref) {
  const cam = (await api.snapshot()).camera;
  let max = 0;
  for (const fx of [0.28, 0.5, 0.72]) {
    for (const fy of [0.28, 0.5, 0.72]) {
      const x = col * TILE - cam.x + fx * TILE;
      const y = VIEWPORT_Y + row * TILE - cam.y + fy * TILE;
      const c = await sampleAt(api, x, y);
      const d = colorDistance(c, ref);
      if (d > max) max = d;
    }
  }
  return max;
}
