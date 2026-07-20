// Case-specific helpers for Coil's automated-validation debug scripts.
//
// Every script here drives the real, deterministic simulation through
// window.__coil (see specs/instrumentation.md): control ops (startRound, setSnake,
// setPellet, setCombo, setScore) only set up PRECONDITIONS, then `step` runs the
// real tick forward and `snapshot` reads the outcome back. Nothing fabricates a
// result. Because reset()/step() put the sim under the driver's manual clock,
// step(dt) advances EXACTLY dt (a whole number of 125 ms ticks), so measurements
// are exact and flake-free — the scripts assert exact values with only tight float
// tolerances, never load/stray-frame slack. For a motion VIDEO clip a script hands
// the clock back with setAutoStep(true) and lets real time pass (liveClip), and
// does not step() during that live clip.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit the
// driver hands every `drive(api, ttc)` (see packages/browser-driver/ttc.mjs). This
// file holds only what is specific to Coil: the grid geometry (mirrored from the
// spec / constants), the arrange-precondition/step/read patterns, input helpers,
// and the pixel/color sampling.

// ---- Grid geometry (specs/board.md, mirrored from reference constants) --------
export const TICK_DT = 0.125; // seconds per fixed tick — 8 ticks/s
export const COLS = 30; // full grid width, including the one-cell wall border
export const ROWS = 18; // full grid height, including the one-cell wall border
export const CELL = 32; // logical px per cell
export const ORIGIN_X = 160; // logical-px top-left of cell (0,0)
export const ORIGIN_Y = 120;
export const STAGE_W = 1280;
export const STAGE_H = 720;

// Interior (playable) bounds — the wall border is the perimeter ring.
export const IN_COL0 = 1;
export const IN_COL1 = COLS - 2; // 28
export const IN_ROW0 = 1;
export const IN_ROW1 = ROWS - 2; // 16

// The snake's start body (specs/board.md): length 3, horizontal, facing right.
export const START_CELLS = [
  { col: 15, row: 8 },
  { col: 14, row: 8 },
  { col: 13, row: 8 },
];
export const START_ROW = 8;

// ---- Timing & scoring (specs/combo.md) ---------------------------------------
export const COMBO_WINDOW = 3.5; // seconds the combo window stays open
export const COMBO_MAX = 5; // multiplier cap
export const POINTS_PER_PELLET = 10; // score = POINTS_PER_PELLET * M

// ---- Maze obstacle course (specs/mode-maze.md) -------------------------------
// The fixed course of interior obstacle cells, point-symmetric through the board
// centre by (col, row) -> (COLS-1-col, ROWS-1-row) i.e. (29-col, 17-row).
export const MAZE_OBSTACLES = [
  { col: 8, row: 4 },
  { col: 9, row: 4 },
  { col: 10, row: 4 },
  { col: 11, row: 4 },
  { col: 12, row: 4 },
  { col: 13, row: 4 },
  { col: 16, row: 13 },
  { col: 17, row: 13 },
  { col: 18, row: 13 },
  { col: 19, row: 13 },
  { col: 20, row: 13 },
  { col: 21, row: 13 },
  { col: 8, row: 10 },
  { col: 8, row: 11 },
  { col: 8, row: 12 },
  { col: 21, row: 5 },
  { col: 21, row: 6 },
  { col: 21, row: 7 },
];

export function cellKey(c) {
  return c.row * COLS + c.col;
}

export function sameCell(a, b) {
  return a && b && a.col === b.col && a.row === b.row;
}

export function onSnake(cell, snake) {
  return snake.some((s) => s.col === cell.col && s.row === cell.row);
}

/** Whether a cell is inside the playable interior (clear of the wall border). */
export function isInterior(c) {
  return (
    c && c.col >= IN_COL0 && c.col <= IN_COL1 && c.row >= IN_ROW0 && c.row <= IN_ROW1
  );
}

// ---- Snake posing --------------------------------------------------------------

/**
 * A straight horizontal snake, head first, facing right: the head at
 * (headCol, row) and the body trailing to the LEFT. Requires headCol-len+1 >= 1.
 */
export function hLane(headCol, row, len) {
  const cells = [];
  for (let i = 0; i < len; i += 1) cells.push({ col: headCol - i, row });
  return cells;
}

/**
 * A straight vertical snake, head first, facing UP: the head at (headCol, headRow)
 * and the body trailing DOWNWARD, so the next tick advances the head up.
 */
export function vLaneUp(headCol, headRow, len) {
  const cells = [];
  for (let i = 0; i < len; i += 1) cells.push({ col: headCol, row: headRow + i });
  return cells;
}

/**
 * A 30-cell snake head-first with the head at (8, 1) facing right and its forward
 * lane (row 1, cols 9..16) clear, so it can advance eight cells with no collision.
 * The body fills row 1 (cols 7..1) then row 2 (cols 1..22), well clear of that lane
 * and of the Maze obstacle course (which never touches rows 1-2). Used to confirm a
 * long snake advances at the same fixed rate as a short one.
 */
export function makeLongSnake() {
  const cells = [{ col: 8, row: 1 }];
  for (let c = 7; c >= 1; c -= 1) cells.push({ col: c, row: 1 }); // cols 7..1 (7 cells)
  for (let c = 1; c <= 22; c += 1) cells.push({ col: c, row: 2 }); // cols 1..22 (22 cells)
  return { snake: cells, dir: "right", headCol: 8, row: 1, advance: 8 };
}

// A cell well off every lane the scripts drive (row 8 and rows 1-2), never on the
// snake and never a Maze obstacle — a safe place to park the pellet so a stepped
// scenario never eats it.
export const PARK_PELLET = { col: 28, row: 16 };

// ---- Round setup ---------------------------------------------------------------

/**
 * Return to the title (optionally seeding pellet placement) and begin a live round
 * in the build's mode, under the manual clock. `startRound` enters `playing` with a
 * fresh snake and first pellet; a following setSnake/setPellet poses the exact
 * scenario. Leaves autoStep false (manual), so step(dt) is the sole clock.
 */
export async function beginRound(api, seed) {
  await api.reset(seed === undefined ? undefined : { seed });
  await api.call("startRound");
}

/**
 * Eat `count` pellets in a clear horizontal lane, one per tick, and report the
 * multiplier, score, head, and auto-spawned pellet after each eat. The snake is
 * posed once at (startCol, row) facing right; each iteration places the pellet one
 * cell ahead of the current head (a precondition) and steps one tick, so the head
 * advances into it and the real eat/combo/scoring/spawn resolve. Requires the round
 * to be live (call beginRound first). `startCol` defaults to 3, so the head runs
 * from col 4 up as it grows — keep `count` small enough to stay off the wall.
 */
export async function eatSequence(api, { startCol = 3, row = 8, count = 4 } = {}) {
  await api.call("setSnake", hLane(startCol, row, 3), "right");
  const combos = [];
  const scores = [];
  const pellets = [];
  const heads = [];
  for (let i = 0; i < count; i += 1) {
    const head = (await api.snapshot()).snake[0];
    await api.call("setPellet", { col: head.col + 1, row: head.row });
    await api.step(TICK_DT);
    const s = await api.snapshot();
    combos.push(s.combo);
    scores.push(s.score);
    pellets.push(s.pellet);
    heads.push(s.snake[0]);
  }
  return { combos, scores, pellets, heads };
}

/**
 * Step `n` single fixed ticks WITHOUT eating, repositioning the snake to a short
 * clear lane before each tick so it never reaches a wall, and parking the pellet off
 * that lane so nothing is eaten. Combo state (multiplier and window) is never touched
 * by setSnake/setPellet, so the window drains exactly one tick per iteration — the
 * clean way to let the combo window lapse over many ticks without the snake dying or
 * eating. Returns the snapshot after each tick.
 */
export async function driftTicks(api, n) {
  const snaps = [];
  for (let i = 0; i < n; i += 1) {
    await api.call("setSnake", hLane(3, 8, 3), "right");
    await api.call("setPellet", { col: 28, row: 1 });
    await api.step(TICK_DT);
    snaps.push(await api.snapshot());
  }
  return snaps;
}

// ---- Board-cleared fill --------------------------------------------------------

/** Interior cells that are not obstacles (the cells a pellet may occupy). */
export function freeCells(obstacles = []) {
  const obs = new Set(obstacles.map(cellKey));
  const out = [];
  for (let row = IN_ROW0; row <= IN_ROW1; row += 1) {
    for (let col = IN_COL0; col <= IN_COL1; col += 1) {
      if (obs.has(row * COLS + col)) continue;
      out.push({ col, row });
    }
  }
  return out;
}

/**
 * Build the board-cleared precondition for the CURRENT mode: the snake occupying
 * every free cell but one, its head adjacent to that one free cell, and the pellet
 * on it. Reads the obstacle set from the live snapshot so it is correct for both
 * Classic (no obstacles) and Maze (18 obstacles). The head is at (27, 8) facing
 * right into the last free cell (28, 8) — both interior and never obstacles — so the
 * next tick eats there, the snake grows to fill every free cell, and the real
 * pellet spawn finds no cell left and ends the round CLEARED. What the check reads
 * (the CLEARED end) resolves through the real tick, not the pose.
 */
export async function buildFillSnake(api) {
  const obstacles = (await api.snapshot()).obstacles || [];
  const free = freeCells(obstacles);
  const E = { col: IN_COL1, row: 8 }; // (28, 8) — the last free cell, eaten to clear
  const H = { col: IN_COL1 - 1, row: 8 }; // (27, 8) — the head, adjacent to E
  const isEorH = (c) => sameCell(c, E) || sameCell(c, H);
  const body = free.filter((c) => !isEorH(c));
  return { snake: [H, ...body], dir: "right", pellet: E, freeCount: free.length };
}

// ---- Input-driven start (pure keyboard) ---------------------------------------

/**
 * Start a round from the title with injected keys — press Enter to confirm the
 * highlighted play entry (CLASSIC or MAZE, the first menu item), so the game enters
 * a live round under normal keyboard control. Used by the controls checks, which
 * confirm the key bindings themselves work. Parks the pellet off-lane so a stepped
 * steering scenario is not disturbed by an eat.
 */
export async function startWithKeys(api) {
  await api.reset();
  await api.call("press", "Enter"); // confirm the first title entry (the play mode)
  await api.call("setPellet", { col: 28, row: 1 }); // off the row-8 steering lane
}

// ---- Live motion clip ----------------------------------------------------------

/**
 * Hand the clock back and let the round play on in real time so a video output
 * captures visible motion. Optionally poses a fresh live scenario first (startRound
 * + setSnake/setPellet). Call this AFTER the deterministic assertions; do not step()
 * during the clip (setAutoStep(true) advances the sim from the wall clock).
 */
export async function liveClip(api, { snake, dir = "right", pellet, ms = 1200 } = {}) {
  await api.call("startRound");
  if (snake) await api.call("setSnake", snake, dir);
  if (pellet) await api.call("setPellet", pellet);
  await api.call("setAutoStep", true);
  await api.wait(ms);
}

// ---- Color sampling (reads the rendered canvas, not a reported value) ---------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// api.pixel(u, v) — u, v are fractions across the game canvas, and the whole 1280x720
// stage fills that canvas (the letterbox is empty space around it), so a logical
// pixel maps to a fraction by dividing by the stage size. Reading the rendered pixel
// (rather than a value the game reports) means a build cannot pass by claiming a
// color it does not draw.

/** Normalized (u, v) of a cell's centre in the rendered canvas. */
export function cellCenterUV(col, row) {
  const x = ORIGIN_X + col * CELL + CELL / 2;
  const y = ORIGIN_Y + row * CELL + CELL / 2;
  return { u: x / STAGE_W, v: y / STAGE_H };
}

/**
 * Average the rendered color over a small 5-point cluster (centre + four neighbours
 * a few px out, all inside the same cell) so a stray antialiased or glow pixel at a
 * sprite edge cannot swing the reading. Returns { r, g, b } (0-255).
 */
export async function sampleCell(api, col, row) {
  const cx = ORIGIN_X + col * CELL + CELL / 2;
  const cy = ORIGIN_Y + row * CELL + CELL / 2;
  const offsets = [
    [0, 0],
    [5, 0],
    [-5, 0],
    [0, 5],
    [0, -5],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [dx, dy] of offsets) {
    const p = await api.pixel((cx + dx) / STAGE_W, (cy + dy) / STAGE_H);
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

// Distinctness thresholds (RGB Euclidean). VISIBLE_MIN: clearly different from the
// dark board background. DISTINCT_MIN: clearly told apart from another game element.
// The snake's head and body are two shades of one hue, so their pairwise threshold
// (HEAD_BODY_MIN) is looser than element-vs-element ones. These may want tuning
// against the captured baseline media once the reference build renders them.
export const VISIBLE_MIN = 45;
export const DISTINCT_MIN = 45;
export const HEAD_BODY_MIN = 22;

/**
 * Pose a clean scene for the color checks: a live round with a straight horizontal
 * snake (head at (10, 8), body cols 9..5) and the pellet at (20, 8), all on the
 * clear centre row, so the head, a straight body segment, the pellet, and an empty
 * patch of board each render an unobstructed color. Works in both modes (row 8 and
 * the sampled cells are clear of the Maze obstacle course). Lets a frame paint so the
 * sampled pixels reflect the posed scene.
 */
export async function poseColorScene(api) {
  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 6), "right"); // head (10,8), body (9..5, 8)
  await api.call("setPellet", { col: 20, row: 8 });
  await api.wait(120);
}

// On-scene sample cells for poseColorScene: the head, a straight body segment, the
// pellet, an empty board patch, and (Maze) an obstacle cell.
export const SCENE_CELLS = {
  head: { col: 10, row: 8 },
  body: { col: 8, row: 8 },
  pellet: { col: 20, row: 8 },
  background: { col: 25, row: 3 },
  obstacle: { col: 8, row: 4 }, // a Maze bar-1 cell (Maze only)
};
