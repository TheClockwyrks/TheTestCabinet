// Case-specific helpers for Deepcore's automated-validation debug scripts.
//
// Every script drives the real, deterministic simulation through window.__deepcore
// (see specs/instrumentation.md): control ops only ARRANGE preconditions, then `step`
// runs the real systems forward and `snapshot`/`tileAt`/`pixel` read the outcome back.
// Nothing fabricates a result. Because reset()/step() put the sim on the driver's clock
// (autoStep = false), a stepped scenario advances by EXACTLY the seconds stepped, so a
// measurement is reproducible regardless of machine load; a motion VIDEO clip re-arms live
// running with setAutoStep(true) before a real-time wait. These helpers factor out the
// common arrange/step/read patterns and the world geometry the scripts depend on (mirrored
// from specs/world.md and the reference constants).
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit the driver
// hands every drive(api, ttc) (packages/browser-driver/ttc.mjs), shared by every case. This
// file holds only what is specific to Deepcore.

// ---- Geometry & constants (specs/overview.md, specs/world.md, specs/controls.md) ----
export const TILE = 80;
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const VIEWPORT_Y = 56; // status bar height; the mine viewport starts here
export const TICK = 1 / 60; // fixed logic tick
export const MINER_W = 57;
export const MINER_H = 73;
export const SPAWN_COL = 15;

// Representative interior rows of each band in the STANDARD mine (coreRow 500, quarters of
// 125 rows each: topsoil 1..125, rockbed 126..250, deepstone 251..375, coreshell 376..499).
export const TOPSOIL_ROW = 60;
export const ROCKBED_ROW = 190;
export const DEEPSTONE_ROW = 310;
export const CORESHELL_ROW = 440;

// Held-key codes for the four movement intents (specs/controls.md — arrows or WASD).
export const K = { down: "ArrowDown", thrust: "ArrowUp", left: "ArrowLeft", right: "ArrowRight" };

// ---- Run setup ------------------------------------------------------------

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

// ---- Driver-clock stepping (exact) ----------------------------------------

/** Advance the real sim by `seconds` and return the fresh snapshot. Under the driver clock
 *  step(seconds) advances by exactly that much (specs/instrumentation.md). */
export async function step(api, seconds) {
  await api.step(seconds);
  return api.snapshot();
}

/** Hold `code` down, advance the real sim `seconds` (the miner moves/drills under its own
 *  update), and return the snapshot. Leaves the key held unless `release`. */
export async function holdFor(api, code, seconds, { release = true } = {}) {
  await api.call("keyDown", code);
  await api.step(seconds);
  const snap = await api.snapshot();
  if (release) await api.call("keyUp", code);
  return snap;
}

/**
 * Step in small chunks until `predicate(snap)` holds or `maxSeconds` elapse; returns
 * `{ snap, hit }`. Used when a script must read state the instant something happens (a tile
 * breaks, a death resolves) rather than at a fixed time.
 */
export async function stepUntil(api, predicate, maxSeconds, chunk = 0.05) {
  let snap = await api.snapshot();
  if (predicate(snap)) return { snap, hit: true };
  const iters = Math.ceil(maxSeconds / chunk);
  for (let i = 0; i < iters; i += 1) {
    await api.step(chunk);
    snap = await api.snapshot();
    if (predicate(snap)) return { snap, hit: true };
  }
  return { snap, hit: false };
}

/** Take a REAL-time live clip so a video output shows motion: hand the clock back with
 *  setAutoStep(true) and let real time pass. Any keys still held keep driving the miner. */
export async function liveClip(api, ms = 900) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
}

// ---- Menu navigation (through the real key handling) ----------------------

/** Tap a key as a one-shot edge (menu move / confirm / activate), applied immediately. */
export async function press(api, code) {
  await api.call("press", code);
}

// ---- Death helpers --------------------------------------------------------

/** Force a hull death underground and step until the Game Over screen resolves; returns the
 *  end snapshot. Routes through the REAL death path (hull <= 0 in live play → triggerDeath). */
export async function killByHull(api, col, row) {
  await standAt(api, col, row);
  await api.call("setHull", 0);
  const r = await stepUntil(api, (s) => s.screen === "game-over", 3, 0.1);
  return r.snap;
}

// ---- Pixel / color sampling (reads the rendered canvas) --------------------
//
// pixel(u, v) samples the ACTUAL rendered largest canvas at a normalized point (see
// packages/browser-driver/driver.mjs). The mine is drawn with the camera offset
// (render.ts): a world point (wx, wy) lands at screen (wx - cameraX, VIEWPORT_Y + wy -
// cameraY) in the fixed 1280x720 logical stage, so a logical stage point maps to a canvas
// fraction by dividing by the stage size. Reading the drawn pixel (not a value the game
// reports) means a build cannot pass a color check by claiming a color it never paints.

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

/** Sample a tile's rendered center color after a settle frame; reads the live camera itself. */
export async function sampleTile(api, col, row) {
  const cam = (await api.snapshot()).camera;
  const s = tileScreen(col, row, cam);
  return sampleAt(api, s.x, s.y);
}

// ---- Material-node discovery ----------------------------------------------

/**
 * Discover BOTH guaranteed buried material nodes of a freshly-generated mine and report each
 * one's material and band. findTile only locates the NEAREST material tile, so we read the
 * nearest, then teleport onto it (carving it away) so the second findTile returns the other
 * node. Returns `[{ material, band, col, row }, ...]` (0, 1, or 2 entries).
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

/** The greatest color distance from `ref` found across a 3x3 grid of points inside a tile — so
 *  a payload that covers only PART of the tile (an ore smear) still registers as present. */
export async function tileMaxDistFrom(api, col, row, ref) {
  const cam = (await api.snapshot()).camera;
  const base = tileScreen(col, row, cam);
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
