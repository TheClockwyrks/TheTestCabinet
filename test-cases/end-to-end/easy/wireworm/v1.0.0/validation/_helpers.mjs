// Case-specific helpers for Wireworm's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__wireworm (see specs/instrumentation.md): control ops only set up
// PRECONDITIONS, then `step` runs the real systems forward and `snapshot` reads the
// outcome back — nothing fabricates a result. These helpers factor out the field
// geometry (mirrored from the spec / constants), the "arrange a precondition, step
// the real sim, read what happened" patterns, the manual-clock stepping, injected
// input, and rendered-pixel color sampling.
//
// The assertion primitives themselves are NOT here — they are the reporter-side
// `ttc` kit the driver hands every `drive(api, ttc)` (see
// `packages/browser-driver/ttc.mjs`), the single source of truth shared by every
// case. This file holds only what is specific to Wireworm. The few helpers that
// record assertions take the script's `check` (from `ttc.checkOne(id)`).

// ---- Stage & board geometry (specs/board.md and the canonical constants) -----
export const STAGE_W = 1280;
export const STAGE_H = 720;
export const BOARD_Y = 80; // top of the board (below the 80px HUD)
export const TILE = 32;
export const COLS = 40; // 0..39
export const ROWS = 20; // 0..19
export const FIXED = 1 / 120; // fixed simulation timestep (matches FIXED_STEP)

// The player band is the bottom two rows (18..19); the cursor is clamped into it.
export const BAND_TOP_ROW = 18;
export const BAND_TOP_Y = BOARD_Y + BAND_TOP_ROW * TILE; // 656
// The cursor centre is clamped to [TILE/2, STAGE_W-TILE/2] x [BAND_TOP_Y+TILE/2,
// STAGE_H-TILE/2] — i.e. x in [16, 1264], y in [672, 704].
export const CURSOR_X_MIN = TILE / 2; // 16
export const CURSOR_X_MAX = STAGE_W - TILE / 2; // 1264
export const CURSOR_Y_MIN = BAND_TOP_Y + TILE / 2; // 672
export const CURSOR_Y_MAX = STAGE_H - TILE / 2; // 704
export const BAND_CX = STAGE_W / 2; // 640, the respawn cursor x
export const BAND_CY = (BAND_TOP_Y + STAGE_H) / 2; // 688, the respawn cursor y

// Tile <-> logical-pixel helpers (matches constants.ts).
export const tileLeft = (c) => c * TILE;
export const tileTop = (r) => BOARD_Y + r * TILE;
export const tileCX = (c) => c * TILE + TILE / 2;
export const tileCY = (r) => BOARD_Y + r * TILE + TILE / 2;

// ---- Snapshot readers --------------------------------------------------------

/** The head tile of the first worm, or undefined if there is no worm. */
export function head(snap) {
  return snap.worms[0]?.segments[0];
}

/** The node at tile (c, r) in a snapshot, or undefined if the tile is empty. */
export function nodeAt(snap, c, r) {
  return snap.nodes.find((n) => n.c === c && n.r === r);
}

/** The charge at tile (c, r): the node's charge, or -1 if the tile is empty. */
export function chargeAt(snap, c, r) {
  const n = nodeAt(snap, c, r);
  return n ? n.charge : -1;
}

/** All foes of a given kind in a snapshot. */
export function foesOf(snap, kind) {
  return snap.foes.filter((f) => f.kind === kind);
}

/** Whether tile (c, r) holds a segment of any worm. */
export function segmentAt(snap, c, r) {
  return snap.worms.some((w) =>
    w.segments.some((s) => s.c === c && s.r === r),
  );
}

// ---- Arranging a clean board -------------------------------------------------

/**
 * Reset (reseeding all randomness) and enter a clean, empty, live board at level
 * 1. `clearField` routes through the real ensureRun (which lays a scattered field
 * and enters active play) and then empties it, so the board is empty and the game
 * is in `playing`/`active` — the state a posed mechanic scenario needs.
 */
export async function freshBoard(api, seed = 1) {
  await api.reset({ seed });
  await api.call("clearField");
}

/** Replace the worms with a single worm laid out by `spec` (segments[0] = head). */
export async function setWorm(api, segments, dh = 1, dv = 1) {
  await api.call("setWorm", { segments, dh, dv });
}

/** A straight horizontal worm of `len` tiles with its head at (headC, r). */
export function straightWorm(headC, r, len, dh = 1) {
  const segs = [];
  for (let i = 0; i < len; i++) segs.push({ c: headC - dh * i, r });
  return segs;
}

// ---- Manual-clock stepping ---------------------------------------------------

/**
 * Advance the real simulation in fixed-step chunks until `predicate(snapshot)`
 * holds, or until `maxSeconds` of game time elapse. Returns `{ snap, hit }`. Under
 * the manual clock each `step` advances exactly the time asked, so a stepped scan
 * is exact and load-independent. `chunk` controls granularity: FIXED to read state
 * the instant something happens, coarser when the read is constant between events.
 */
export async function stepUntil(api, predicate, maxSeconds, chunk = FIXED) {
  let snap = await api.snapshot();
  if (predicate(snap)) return { snap, hit: true };
  const iters = Math.ceil(maxSeconds / chunk);
  for (let i = 0; i < iters; i++) {
    await api.step(chunk);
    snap = await api.snapshot();
    if (predicate(snap)) return { snap, hit: true };
  }
  return { snap, hit: false };
}

/**
 * Advance the real simulation by exactly one worm tile-step, detected by the head
 * moving to a new tile. Returns the snapshot the instant the worm stepped (or the
 * last snapshot if the worm vanished / never moved within the cap).
 */
export async function wormStep(api, maxSeconds = 4) {
  const before = head(await api.snapshot());
  if (!before) return api.snapshot();
  const iters = Math.ceil(maxSeconds / FIXED);
  for (let i = 0; i < iters; i++) {
    await api.step(FIXED);
    const snap = await api.snapshot();
    const h = head(snap);
    if (!h) return snap;
    if (h.c !== before.c || h.r !== before.r) return snap;
  }
  return api.snapshot();
}

/** Advance the worm `n` tile-steps and return the final snapshot. */
export async function wormSteps(api, n, maxSeconds = 4) {
  let snap = await api.snapshot();
  for (let i = 0; i < n; i++) snap = await wormStep(api, maxSeconds);
  return snap;
}

/**
 * Fire a bolt from the cursor now and step the real shot code forward until the
 * bolt resolves (leaves the board or is consumed by a hit). Returns the snapshot
 * the instant no bolts remain in flight.
 */
export async function fireAndResolve(api, maxSeconds = 1.5) {
  await api.call("fire");
  return (await stepUntil(api, (s) => s.bolts.length === 0, maxSeconds)).snap;
}

// ---- Live motion clips -------------------------------------------------------

/**
 * Run the game live for a recorded video clip: switch the manual clock back to
 * real time (setAutoStep true) and let `ms` of wall-clock time pass so the clip
 * shows on-screen motion. The caller poses the scenario first; nothing is stepped
 * during the live clip, so the recording shows the real game running itself.
 */
export async function liveClip(api, ms = 1200) {
  await api.call("setAutoStep", true);
  await api.wait(ms);
}

// ---- Injected-input helpers --------------------------------------------------

/**
 * Hold a movement key and report how the cursor moved. Steps the real sim for a
 * deterministic verdict (the cursor moves through the game's normal moveCursor code
 * as the manual clock steps), then releases the key. Returns
 * `{ dx, dy, before, after }`.
 */
export async function holdMove(api, code, stepS = 0.5) {
  const before = (await api.snapshot()).cursor;
  await api.call("keyDown", code);
  await api.step(stepS);
  const after = (await api.snapshot()).cursor;
  await api.call("keyUp", code);
  return { dx: after.x - before.x, dy: after.y - before.y, before, after };
}

const HMOVE_MIN = 40; // a clearly non-trivial horizontal displacement, in px
const VMOVE_MIN = 10; // the band is only ~32px tall, so a smaller vertical bound

/**
 * A movement-key control check, shared by every controls-movement item: from a
 * clean live board, place the cursor at a start clear of the bound it moves toward,
 * hold `code`, and confirm the cursor moves the expected way, then record a live
 * clip. `axis` is "x" or "y"; `dir` is -1 (left/up) or +1 (right/down).
 */
export async function moveControlCheck(api, check, { code, axis, dir, startX, startY }) {
  await freshBoard(api);
  await api.call("setCursor", startX, startY);
  const r = await holdMove(api, code);
  const delta = axis === "x" ? r.dx : r.dy;
  const min = axis === "x" ? HMOVE_MIN : VMOVE_MIN;
  const way =
    dir < 0 ? (axis === "x" ? "left" : "up") : axis === "x" ? "right" : "down";
  if (dir < 0) {
    check.expectLt(`holding ${code} moves the cursor ${way} (Δ${axis})`, delta, -min);
  } else {
    check.expectGt(`holding ${code} moves the cursor ${way} (Δ${axis})`, delta, min);
  }
  // A live clip of the cursor sliding.
  await freshBoard(api);
  await api.call("setCursor", startX, startY);
  await api.call("setAutoStep", true);
  await api.call("keyDown", code);
  await api.wait(650);
  await api.call("keyUp", code);
}

/**
 * A pause-key control check: from a clean live board, press `code` and confirm the
 * game pauses, then record a short clip of a moment of play then the pause.
 */
export async function pauseControlCheck(api, check, code) {
  await freshBoard(api);
  await api.call("press", code);
  check.expectEq(`pressing ${code} pauses the game`, (await api.snapshot()).screen, "paused");
  // A live clip: a beat of play, then the pause.
  await freshBoard(api);
  await api.call("setLevel", 1);
  await api.call("setAutoStep", true);
  await api.wait(500);
  await api.call("press", code);
  await api.wait(600);
}

// ---- Rendered-pixel color sampling ------------------------------------------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — u, v are fractions across the game canvas — so a logical
// pixel maps to a fraction by dividing by the stage size and a script never has to
// know the canvas's device dimensions. Reading the rendered pixel (not a color the
// game reports) means a build cannot pass by returning a value it does not draw.

/**
 * Average the rendered color over a small 5-point cluster (centre + four neighbours
 * a few px out) around a logical-pixel point, so a stray antialiased edge pixel
 * cannot swing the reading. Returns `{ r, g, b }` (0–255).
 */
export async function sampleColor(api, x, y) {
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

/** Perceived brightness of an RGB color (0–255). */
export function brightness(c) {
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
}
