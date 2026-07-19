// Case-specific helpers for Floe's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__floe (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then `step` runs the real hopping, drift, collision, pursuit,
// scoring, and level logic forward, and `snapshot` (or `pixel`) reads the outcome
// back. Nothing fabricates a result. These helpers factor out the common
// "arrange the world, step the real sim, read what happened" patterns, the input
// helpers that drive the game the way a player does, and the strait geometry the
// scripts depend on (mirrored from the spec / canonical constants).
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit the driver hands every `drive(api, ttc)` (see
// `packages/browser-driver/ttc.mjs`), shared by every case. This file holds only
// what is specific to Floe.

// ---- Stage & strait geometry (specs/playfield.md, canonical constants) -----
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const HUD_H = 80; // the strait sits below the 80px HUD bar
export const STRAIT_W = 1280;
export const TILE = 32;
export const FIXED = 1 / 120; // physics timestep (matches FIXED_STEP)

// Band rows (strait-local): far-shore cap 0, bays 1, water 2..9, median 10,
// ice 11..18, near shore 19.
export const ROW_BAYS = 1;
export const WATER_TOP = 2;
export const WATER_BOTTOM = 9;
export const ROW_MEDIAN = 10;
export const ICE_TOP = 11;
export const ICE_BOTTOM = 18;
export const ROW_NEAR = 19;

// The five goal bays, each two tiles wide (specs/playfield.md), left column first.
export const BAYS = [
  [3, 4],
  [11, 12],
  [19, 20],
  [27, 28],
  [35, 36],
];
export const BAY_LEFT = BAYS.map((b) => b[0]);

// ---- Stepping ---------------------------------------------------------------

/**
 * Advance the real simulation in fixed chunks until `predicate(snapshot)` holds,
 * or until `maxSeconds` of game time elapse. Returns `{ snap, hit }`. `chunk`
 * controls granularity: pass FIXED (one step) when the instant something happens
 * matters (a crush, a bounce, a single glide step), or a coarser value when the
 * quantity read is stable between events (a pursuit closing) so the sweep is cheap.
 */
export async function stepUntil(api, predicate, maxSeconds, chunk = FIXED) {
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

// ---- Preconditions (route through the real systems) -------------------------

/** Reset to the title and begin a fresh run, as choosing CROSS from the menu. */
export async function startCrossing(api, seed) {
  await api.reset(seed === undefined ? undefined : { seed });
  await api.call("startGame");
}

/** Clear every ice-band lane (rows 11..18) — empty, traversable road. */
export async function clearIce(api) {
  for (let r = ICE_TOP; r <= ICE_BOTTOM; r += 1) {
    await api.call("setLane", r, { cols: [] });
  }
}

/**
 * Build a clean vertical corridor at strait column `col`: every ice lane cleared,
 * and a stationary floe under `col` on every water row. A critter placed at `col`
 * can then hop straight from the near shore to the far shore without meeting a
 * vehicle or open water — so a check can drive a full, uninterrupted crossing and
 * read the real scoring, level, and pursuit logic that results.
 */
export async function buildSafeColumn(api, col) {
  await clearIce(api);
  for (let r = WATER_TOP; r <= WATER_BOTTOM; r += 1) {
    await api.call("setLane", r, { cols: [col], speed: 0 });
  }
}

/**
 * Pose the critter at the bottom of a safe corridor at `col` (call after
 * `startCrossing` + `buildSafeColumn`), ready to climb it. The critter begins at
 * the near shore, so `bestRow` stays at the near shore and each real up-hop scores
 * its row as it is reached.
 */
export async function poseClimb(api, col) {
  await buildSafeColumn(api, col);
  await api.call("placeCritter", col, ROW_NEAR);
}

// ---- Input-driven play (drives the game the way a player does) --------------

/**
 * Hop the critter straight up, one real hop per press, until it reaches
 * `stopRow` (or a cap of hops as a safety net). Each `press` sets the pending hop
 * and the following `step` runs the real hop through the game's own play code, so
 * the climb exercises the actual controls and scoring — not a posed jump. Stops
 * before the row that would enter a bay, so a caller controls the final hop.
 */
export async function climbByPress(api, code, stopRow, { maxHops = 40 } = {}) {
  for (let i = 0; i < maxHops; i += 1) {
    const s = await api.snapshot();
    if (s.critter.row <= stopRow || s.phase !== "crossing") break;
    await api.call("press", code);
    await api.step(0.13); // just over the hop cooldown, so the next press hops
  }
  return api.snapshot();
}

// ---- Pixel / color sampling (reads the rendered canvas) ---------------------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas, so a stage
// pixel maps to a fraction by dividing by the stage size and a script never has to
// know the canvas's pixel dimensions. Reading the rendered pixel (rather than a
// color the game merely reports) means a build cannot pass by returning a value it
// does not draw.

/** Stage-pixel center of a strait tile (col, row): x across, y below the HUD. */
export function tileCenter(col, row) {
  return { x: TILE * col + TILE / 2, y: HUD_H + TILE * row + TILE / 2 };
}

/**
 * Average the rendered color over a small 5-point cluster (center + four
 * neighbors a few px out) around a STAGE pixel, so a stray antialiased or glow
 * pixel at an edge cannot swing the reading. Returns `{ r, g, b }` (0..255).
 */
export async function sampleStage(api, sx, sy) {
  const offsets = [
    [0, 0],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const p = await api.pixel((sx + dx) / STAGE_W, (sy + dy) / STAGE_H);
    r += p.r;
    g += p.g;
    b += p.b;
  }
  const n = offsets.length;
  return { r: r / n, g: g / n, b: b / n };
}

/** Sample the rendered color at the center of a strait tile (col, row). */
export async function sampleTile(api, col, row) {
  const c = tileCenter(col, row);
  return sampleStage(api, c.x, c.y);
}

/** Euclidean distance between two RGB colors (0 to ~441). */
export function colorDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * Pose a clean, live scene for the color checks: a fresh crossing with a water row
 * and an ice row cleared (so their band colors read unobstructed), the critter on
 * the median, and a bear on the cleared road. A short real-time pause lets a frame
 * paint the posed scene before the pixels are sampled.
 */
export async function poseColorScene(api) {
  await startCrossing(api);
  await api.call("setLane", 5, { cols: [] }); // open-water sample row
  await api.call("setLane", 15, { cols: [] }); // road sample row
  await api.call("placeCritter", 20, ROW_MEDIAN); // critter on the median
  await api.call("setBear", 0, { col: 24, row: 15 }); // bear on the road
  await api.wait(60); // let a frame paint the posed scene
}

// ---- Hop pocket (isolated controls checks) ----------------------------------

/**
 * Pose a small safe pocket the critter can hop around in without meeting a hazard:
 * a fresh crossing with the top two ice lanes cleared and the critter on the top
 * ice row. Up lands on the median, down on cleared ice, and left/right on cleared
 * ice — every direction is a safe, solid tile, so a controls check reads only the
 * hop the key produced.
 */
export async function hopPocket(api) {
  await startCrossing(api);
  await api.call("setLane", ICE_TOP, { cols: [] });
  await api.call("setLane", ICE_TOP + 1, { cols: [] });
  await api.call("placeCritter", 20, ICE_TOP);
}

/**
 * A single-direction control check: from the pocket, one real press hops the
 * critter exactly one tile in the expected direction (dcol/drow), with no death.
 * Then a real-time clip re-poses the pocket and hops once more so the recorded
 * video shows the sprite hopping. Records into `check`.
 */
export async function hopControlCheck(api, check, { code, dcol, drow, who }) {
  await hopPocket(api);
  const before = (await api.snapshot()).critter;
  await api.call("press", code);
  await api.step(0.15);
  const after = await api.snapshot();
  check.expectEq(`${who}: column after the hop`, after.critter.col, before.col + dcol);
  check.expectEq(`${who}: row after the hop`, after.critter.row, before.row + drow);
  check.expectEq(`${who}: no death from a normal hop`, after.screen, "playing");
  check.expectNe(`${who}: still crossing`, after.phase, "dying");

  // Clip: re-pose and hop once in real time so the video shows the hop.
  await hopPocket(api);
  await api.wait(250);
  await api.call("press", code);
  await api.wait(500);
}
