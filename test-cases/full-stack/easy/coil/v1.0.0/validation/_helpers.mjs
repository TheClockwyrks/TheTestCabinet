// Case-specific helpers for Coil's automated-validation items.
//
// Every helper here drives the real, deterministic simulation through
// window.__coil (see specs/instrumentation.md): control ops (startRound, setSnake,
// setPellet, setCombo, setScore) only set up PRECONDITIONS, then time runs the real
// tick forward and `snapshot` reads the outcome back. Nothing fabricates a result.
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
// A helper that only poses state (`beginRound`, `startWithKeys`, `buildFillSnake`)
// is unpaired: it is arrange-callable on its own. Everything else that consumes
// time is an `actX`, named for the scenario its arrange half posed, and the two
// must be used together — the act half assumes its arrange half posed the world.
//
// UNITS ARE TICKS. Coil is an 8 Hz fixed timestep (a 125 ms tick, specs/movement.md)
// and the debug API's `step` takes whole ticks, so every duration below is a tick
// count and the runtime converts it to wall-clock for the record pass. The seconds
// these replace are noted inline. The one place seconds survive is the COMBO
// WINDOW: `setCombo(multiplier, windowSeconds)` poses the window rather than
// advancing time, and the snapshot reports `comboWindow` in simulation seconds, so
// those two stay in seconds exactly as the spec defines them. Use TICK_SECONDS to
// convert between the two domains.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit
// (`packages/browser-driver/ttc.mjs`), the single source of truth shared by every
// case. This file holds only what is specific to Coil: the grid geometry (mirrored
// from the spec / constants), the arrange/act patterns, input helpers, and the
// pixel/color sampling.

// ---- Grid geometry (specs/board.md, mirrored from reference constants) --------

// The simulation rate, and the finest granularity a sweep can poll at. One tick is
// one fixed 125 ms simulation step (this replaces the old `TICK_DT = 0.125` seconds
// constant, which every script passed to `api.step`); pass `poll: TICK` to
// `api.until` when the exact instant of an event matters.
export const TICK_HZ = 8;
export const TICK = 1;
// One tick's length in simulation seconds. NOT a step amount — `api.advance` takes
// ticks. This exists only to relate a tick count to the seconds-domain combo window
// (`setCombo`'s `windowSeconds`, the snapshot's `comboWindow`).
export const TICK_SECONDS = 1 / TICK_HZ; // 0.125

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
export const COMBO_WINDOW = 3.5; // SECONDS the combo window stays open (setCombo's unit)
export const COMBO_WINDOW_TICKS = COMBO_WINDOW * TICK_HZ; // 28 ticks — the same span in the act unit
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

// ---- Pure geometry (no api; callable from any phase) -------------------------

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

// ---- Round setup (arrange) -----------------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/**
 * Return to the title (optionally seeding pellet placement) and begin a live round
 * in the build's mode. `startRound` enters `playing` with a fresh snake and first
 * pellet; a following setSnake/setPellet poses the exact scenario. Instant — the
 * runtime, not this helper, decides which clock `act` then runs under.
 */
export async function beginRound(api, seed) {
  await api.reset(seed === undefined ? undefined : { seed });
  await api.call("startRound");
}

/**
 * ARRANGE half of every forced-eat run: pose a short snake at the left of a clear
 * horizontal lane, facing right, so `actEatSequence` can walk it rightward eating a
 * pellet a tick. `startCol` defaults to 3, so the head runs from col 4 up as the
 * snake grows — keep the act half's `count` small enough to stay off the wall.
 *
 * Pair with `actEatSequence`.
 */
export async function arrangeEatLane(api, { startCol = 3, row = 8, len = 3 } = {}) {
  await api.call("setSnake", hLane(startCol, row, len), "right");
}

/**
 * Start a round from the title with injected keys — press Enter to confirm the
 * highlighted play entry (CLASSIC or MAZE, the first menu item), so the game enters
 * a live round under normal keyboard control. Used by the controls checks, which
 * confirm the key bindings themselves work. Parks the pellet off-lane so a stepped
 * steering scenario is not disturbed by an eat. Menu navigation is instant (single
 * key presses), so this is arrange-callable on its own.
 */
export async function startWithKeys(api) {
  await api.reset();
  await api.call("press", "Enter"); // confirm the first title entry (the play mode)
  await api.call("setPellet", { col: 28, row: 1 }); // off the row-8 steering lane
}

// ---- Timed drives (act) --------------------------------------------------------

/**
 * ACT half of a forced-eat run: eat `count` pellets in the clear lane
 * `arrangeEatLane` posed, one per tick, and report what the real eat resolved to
 * after each. Each iteration places the pellet one cell ahead of the CURRENT head
 * (a precondition) and advances one tick, so the head runs into it and the real
 * eat / combo / scoring / spawn all resolve through the tick.
 *
 * Pair with `arrangeEatLane`. Returns `{ combos, scores, pellets, heads, snaps }` —
 * four parallel arrays of the per-eat multiplier, score, AUTO-spawned pellet (the
 * one the real spawn code chose, not the one posed), and head cell, plus `snaps`,
 * the full snapshot after each eat for a caller that needs more than those four.
 * The first four are what the old `eatSequence` returned.
 */
export async function actEatSequence(api, { count = 4 } = {}) {
  const combos = [];
  const scores = [];
  const pellets = [];
  const heads = [];
  const snaps = [];
  for (let i = 0; i < count; i += 1) {
    const head = (await api.snapshot()).snake[0];
    await api.call("setPellet", { col: head.col + 1, row: head.row });
    await api.advance(1); // 1 tick = the old step(TICK_DT); the head enters the pellet cell
    const s = await api.snapshot();
    combos.push(s.combo);
    scores.push(s.score);
    pellets.push(s.pellet);
    heads.push(s.snake[0]);
    snaps.push(s);
  }
  return { combos, scores, pellets, heads, snaps };
}

/**
 * ACT half of a combo-lapse drive: advance `n` single ticks WITHOUT eating, so the
 * combo window drains exactly one tick per iteration — the clean way to let a combo
 * lapse over many ticks without the snake dying or eating. The snake runs along row
 * 8 and the pellet is parked in row 1, off that lane, so nothing is ever eaten.
 *
 * The snake is re-posed to the start of the lane only when its head approaches the
 * right wall, NOT every tick. Both are correct for the verdict — `setSnake` writes
 * only snake/dir/turnBuffer and never touches combo or score (see sim.ts), so how
 * often it runs cannot move an assertion — but they film very differently. Re-posing
 * every tick pinned the head between columns 3 and 4, so the recorded clip showed
 * the snake twitching in place for the whole drain instead of moving. Letting it
 * cross the field and snap back once reads as a snake gliding while the combo meter
 * empties, which is what the item is about. Row 8 is clear of the Maze variant's
 * obstacles too, so the full crossing is safe in both variants.
 *
 * Re-posing mid-`act` at all is deliberate and legal: setSnake/setPellet are control
 * ops, which set state without touching the clock.
 *
 * Unpaired on the arrange side beyond a live round — it poses its own lane. Returns
 * the snapshot after each tick (what the old `driftTicks` returned).
 */
// Head column at which the lane is re-posed. The playable grid ends at column 28
// (COLS 30, one-cell wall border), so this leaves room for the tick that follows.
const DRIFT_REPOSE_AT_COL = 27;

export async function actDriftTicks(api, n) {
  const snaps = [];
  const poseLane = async () => {
    await api.call("setSnake", hLane(3, 8, 3), "right");
    await api.call("setPellet", { col: 28, row: 1 });
  };

  await poseLane();
  for (let i = 0; i < n; i += 1) {
    const head = (await api.snapshot()).snake[0];
    if (head.col >= DRIFT_REPOSE_AT_COL) await poseLane();
    await api.advance(1); // 1 tick = the old step(TICK_DT)
    snaps.push(await api.snapshot());
  }
  return snaps;
}

/**
 * ACT half of a steering check: press a steering key and advance the one tick that
 * applies the buffered turn (a turn takes effect at step 1 of the NEXT tick, see
 * specs/movement.md), then report the direction the snake is actually moving.
 * The injected key flows through the real key handling, so this exercises the real
 * binding rather than a parallel path.
 *
 * Pair with `startWithKeys`. Returns the snapshot's `dir` after the tick.
 */
export async function actSteer(api, code) {
  await api.call("press", code);
  await api.advance(1); // 1 tick = the old step(TICK_DT); the buffered turn applies
  return (await api.snapshot()).dir;
}

/**
 * ACT tail: let the posed scenario keep playing for a readable moment so the
 * RECORDED clip shows the checked behavior instead of a single 125 ms flicker.
 *
 * Call this only AFTER the outcome the assertions read has been captured. It can
 * never change a verdict — the validate pass advances instantly and the state it
 * runs on has already been read — and it films the SAME scenario the check drove,
 * which is what makes it legitimate where the old `liveClip` (which re-posed a
 * different scenario and handed the clock back) was not.
 *
 * The default of 10 ticks is 1.25 s, matching the old `liveClip`'s 1200 ms. Raise
 * it for a scenario that needs longer to read on camera; the runtime's clip budget
 * caps the recording either way, so a generous value costs nothing.
 */
export async function actPlayOn(api, ticks = 10) {
  await api.advance(ticks);
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
 *
 * A snapshot read and a computation only, so it is arrange-callable; the caller
 * still has to apply the returned pose with setSnake/setPellet.
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

// On-scene sample cells for arrangeColorScene: the head, a straight body segment,
// the pellet, an empty board patch, and (Maze) an obstacle cell.
export const SCENE_CELLS = {
  head: { col: 10, row: 8 },
  body: { col: 8, row: 8 },
  pellet: { col: 20, row: 8 },
  background: { col: 25, row: 3 },
  obstacle: { col: 8, row: 4 }, // a Maze bar-1 cell (Maze only)
};

/**
 * ARRANGE half of the color checks: pose a clean scene — a live round with a
 * straight horizontal snake (head at (10, 8), body cols 9..5) and the pellet at
 * (20, 8), all on the clear centre row, so the head, a straight body segment, the
 * pellet, and an empty patch of board each render an unobstructed color. Works in
 * both modes (row 8 and the sampled cells are clear of the Maze obstacle course).
 *
 * Posing only; the repaint the samples need happens in the act half, because the
 * pause that lets a frame land consumes real time.
 *
 * Pair with `actColorSamples`.
 */
export async function arrangeColorScene(api) {
  await beginRound(api);
  await api.call("setSnake", hLane(10, 8, 6), "right"); // head (10,8), body (9..5, 8)
  await api.call("setPellet", { col: 20, row: 8 });
}

/**
 * ACT half of the color checks: let a frame paint so the sampled pixels reflect the
 * posed scene, then sample every cell of SCENE_CELLS.
 *
 * Pair with `arrangeColorScene`. Returns `{ head, body, pellet, background,
 * obstacle }`, each an `{ r, g, b }` from `sampleCell`. Together this replaces the
 * old `poseColorScene`, whose trailing `api.wait(120)` is the settle below.
 */
export async function actColorSamples(api, { settleMs = 120 } = {}) {
  // A REAL pause, not `advance`. These checks read the pixels the build actually
  // DREW, and no amount of instant stepping produces a painted frame; without a
  // settle the sample races the repaint and can read a stale canvas, failing a
  // build that painted the scene correctly. See `api.settle` in validation.mjs.
  await api.settle(settleMs);
  const out = {};
  for (const [name, c] of Object.entries(SCENE_CELLS)) {
    out[name] = await sampleCell(api, c.col, c.row);
  }
  return out;
}

/**
 * ACT half of a static-screen capture: let the screen repaint and capture it, for
 * the items whose evidence is a still of a posed state (the title, the how-to
 * screen, the pause overlay, a game-over or board-cleared panel, a spawned pellet).
 * `api.screenshot` no-ops in the validate pass, so this only produces media.
 *
 * Replaces the old trailing `await api.wait(ms); await api.screenshot(id)` pair.
 * Pass `shot: null` to settle without capturing. Returns the snapshot after the
 * settle, so an item can read the screen it just filmed.
 */
export async function actSettleShot(api, shot, { settleMs = 150 } = {}) {
  await api.settle(settleMs);
  if (shot) await api.screenshot(shot);
  return api.snapshot();
}
