// Case-specific helpers for Cascade's automated-validation items.
//
// Every helper here drives the real, deterministic game through window.__cascade
// (see specs/instrumentation.md): control ops only set up PRECONDITIONS (deal a
// board, arrange exact piles, inject pointer input), then the real rules engine
// and the real victory-cascade simulation resolve the outcome, which `snapshot`
// (or `pixel`) reads back. Nothing fabricates a result.
//
// The helpers are split along the runtime's arrange/act seam (see
// `packages/browser-driver/validation.mjs`). An item runs TWICE — once with time
// instant to decide the verdict, once in real time to record the media — and the
// runtime enforces the split by throwing if `arrange` consumes time:
//
//   * a POSING helper (`pose`, `deal`, `winBoard`, and every geometry function)
//     uses control ops and instant reads only. Callable from `arrange`, it runs in
//     BOTH passes, so the record pass reaches `act` in exactly the state the check
//     saw.
//   * an `actX(api, ...)` helper consumes time via `api.advance` / `api.until` and
//     returns the outcome the assertions read. Callable from `act`, and the only
//     part filmed.
//
// UNITS ARE TICKS. Cascade's one time-driven system is the victory cascade, run on
// a 120 Hz fixed timestep, and the debug API's `step` takes whole ticks
// (specs/instrumentation.md), so every DURATION below is a tick count and the
// runtime converts it to wall-clock for the record pass. The seconds these replace
// are noted inline.
//
// Two things are deliberately NOT durations in ticks:
//
//   * `FIXED_DT` (below) is the timestep in SECONDS. It belongs in physics math —
//     the spec states gravity as `vy += 1800 * dt` — and must never be handed to
//     `api.advance`, which counts ticks. It is named `FIXED_DT` rather than the old
//     `FIXED` precisely so a stale `advance(FIXED)` fails loudly at import.
//   * `api.settle(ms)` is real milliseconds in BOTH passes and exists only to let a
//     frame PAINT before a check reads the canvas (`sampleColor`, `api.screenshot`).
//     It never moves the game. Anything meant to advance the cascade is `advance`.
//
// Cascade is instant everywhere except the victory cascade: dealing, moves, stock
// turns and pointer input all resolve immediately. So outside the won screen
// `api.advance(n)` moves no game state at all (the build's `step` is a documented
// no-op off a running cascade) and serves purely as clip pacing — a real beat in
// the record pass, free in the validate pass. `ticksFor(ms)` converts an intended
// beat into that tick count.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit
// (`packages/browser-driver/ttc.mjs`), the single source of truth shared by every
// case. This file holds only what is specific to Cascade.

// ---- Field + table geometry (specs/table.md, specs/overview.md) ------------
export const FIELD_W = 1280;
export const FIELD_H = 720;

// ---- The simulation clock (specs/victory.md, specs/instrumentation.md) -----

// The victory cascade's fixed rate. One tick is one fixed simulation step; pass
// `poll: TICK` to `api.until` when the exact instant of an event matters, and
// `SECOND` ticks to `api.advance` for a second of cascade time.
export const TICK_HZ = 120;
export const TICK = 1;
export const SECOND = TICK_HZ; // 120 ticks = 1 s of game time

// The timestep in SECONDS — for PHYSICS MATH ONLY (`GRAVITY * FIXED_DT` is the
// per-step change in vy the spec mandates). Never a duration to advance by; this
// replaces the old `FIXED = 1 / 120` constant, which was used for both.
export const FIXED_DT = 1 / TICK_HZ;

/** A duration in whole ticks, from an intended wall-clock beat in milliseconds. */
export function ticksFor(ms) {
  return Math.max(0, Math.round(((Number(ms) || 0) * TICK_HZ) / 1000));
}

/** Seconds of game time spanned by `ticks`, for a check stated in seconds. */
export function secondsOf(ticks) {
  return ticks * FIXED_DT;
}

export const CARD_W = 100;
export const CARD_H = 140;

export const COLS_X = [224, 346, 468, 590, 712, 834, 956];
export const TOP_Y = 24; // top row (stock / waste / foundations)
export const TABLEAU_Y = 180; // top of the tableau columns
export const STOCK_X = 224;
export const WASTE_X = 346;
export const FOUNDATION_X = [590, 712, 834, 956];

// Tableau column overlap (specs/table.md), mirrored so a pointer-driven script can
// find any card's on-screen position.
export const FACE_DOWN_OFFSET = 24;
export const FACE_UP_OFFSET = 34;
export const FACE_UP_OFFSET_MIN = 14;
export const COLUMN_BOTTOM_LIMIT = 676;
export const WASTE_FAN = 26; // Draw Three fans the turned cards by this pitch

// ---- Victory cascade constants (specs/victory.md) --------------------------
export const GRAVITY = 1800; // px/s^2, downward
export const BOUNCE_DAMP = 0.8; // vy retained per floor bounce
export const LAUNCH_VY = -120; // initial upward pop, px/s
export const LAUNCH_INTERVAL = 0.18; // one card every 0.18 s
export const FLOOR_Y = FIELD_H - CARD_H; // 580 — seated top-y on the floor
export const TOTAL_CARDS = 52;

// The whole cascade, in ticks: 52 cards launch over ~9.4 s and the last must then
// fall and drift off an edge. 40 s is comfortably past that, and is what the old
// `step(40)` ran. `until` stops as soon as `done` is set, so this is only a bound.
export const CASCADE_DONE_MAX = 40 * SECOND; // 4800 ticks

// The table felt color (COLOR.felt, #1a7a4a), so a color check can tell a painted
// card pixel from the bare table.
export const FELT = { r: 0x1a, g: 0x7a, b: 0x4a };

// ---- Card / board builders -------------------------------------------------

/** A card spec for setBoard; `faceUp` is omitted (pile default) unless given. */
export function card(suit, rank, faceUp) {
  const c = { suit, rank };
  if (faceUp !== undefined) c.faceUp = faceUp;
  return c;
}

/** A single suit's cards, ranks `from`..`to` inclusive (face-up by pile default). */
export function suitRun(suit, from, to) {
  const out = [];
  for (let r = from; r <= to; r += 1) out.push({ suit, rank: r });
  return out;
}

/** `n` distinct cards drawn from a fixed pool (for stock/turn scenarios). */
export function someCards(n) {
  const suits = ["spades", "hearts", "diamonds", "clubs"];
  const pool = [];
  for (let r = 1; r <= 13 && pool.length < n; r += 1) {
    for (const s of suits) if (pool.length < n) pool.push({ suit: s, rank: r });
  }
  return pool.slice(0, n);
}

// ---- Posing helpers (arrange) ----------------------------------------------
//
// These pose the world with control ops and consume no time, so they are callable
// straight from `arrange` and need no act half.

/** Reset (optionally seeded) and arrange an exact board, entering play. */
export async function pose(api, board, seed) {
  await api.reset(seed === undefined ? undefined : { seed });
  await api.call("setBoard", board);
}

/** Reset with a seed and deal a fresh, reproducible game; return the snapshot. */
export async function deal(api, seed) {
  await api.reset({ seed });
  await api.call("newGame");
  return api.snapshot();
}

/** A stable, order-sensitive string form of a dealt tableau, for comparing deals. */
export function serializeTableau(snap) {
  return JSON.stringify(
    snap.tableau.map((col) =>
      col.map((c) => `${c.suit[0]}${c.rank}${c.faceUp ? "^" : "v"}`),
    ),
  );
}

/**
 * Arrange a real, complete win and let the real win check fire the cascade. The
 * four foundations are posed complete except spades' King, which sits on the waste;
 * moving it home through the real `move` op completes the last foundation, so the
 * game's own `isWin`/`startCascade` path runs — nothing fabricates the win. The
 * seed makes the launch velocities reproducible. Returns the post-win snapshot.
 *
 * Arrange-only: every op is instant, and the cascade it starts has advanced by
 * nothing yet, so `act` decides how much of it to run (and film).
 */
export async function winBoard(api, seed = 1) {
  await api.reset({ seed });
  const foundations = [
    suitRun("spades", 1, 12), // missing its King
    suitRun("hearts", 1, 13),
    suitRun("diamonds", 1, 13),
    suitRun("clubs", 1, 13),
  ];
  await api.call("setBoard", { foundations, waste: [card("spades", 13, true)] });
  await api.call("move", { pile: "waste" }, { pile: "foundation", index: 0 });
  return api.snapshot();
}

// ---- Cascade act helpers (act) ---------------------------------------------
//
// These consume time and so are callable only from `act`. Each assumes `winBoard`
// posed the win in `arrange`.

/**
 * Advance one tick, which launches the first card and applies one step of gravity,
 * and return that flyer. The single-tick launch is what makes the gravity and
 * bounce checks exact: the flyer's state after it is fully determined by the spec.
 */
export async function actFirstFlyer(api) {
  await api.advance(TICK);
  const snap = await api.snapshot();
  return snap.cascade.flyers[0];
}

/**
 * Advance a tick at a time until the first flyer bounces off the floor, and return
 * `{ prev, cur, bounced }` — the flyer either side of that tick.
 *
 * A bounce is the tick where downward motion (`vy > 0`) becomes upward (`vy < 0`),
 * which needs the PREVIOUS tick's flyer as well as the current one, so this cannot
 * be an `api.until` predicate (those see only the current snapshot). Call
 * `actFirstFlyer` first: this steps on from whatever flyer state it left.
 */
export async function actFirstBounce(api, { max = 400 } = {}) {
  let prev = (await api.snapshot()).cascade.flyers[0];
  for (let i = 0; i < max; i += 1) {
    await api.advance(TICK);
    const cur = (await api.snapshot()).cascade.flyers[0];
    if (prev && cur && prev.vy > 0 && cur.vy < 0) return { prev, cur, bounced: true };
    prev = cur;
  }
  return { prev, cur: prev, bounced: false };
}

/**
 * Advance a tick at a time, recording the tick at which each new card launches,
 * until `count` launches have been seen or `max` ticks are spent. Returns
 * `{ ticks, launched }` — the launch instants (in ticks since the call) and the
 * cascade's own launched counter, so a check can confirm cards launch one at a
 * time as well as on cadence.
 *
 * Tick-granular because the cadence being measured (0.18 s = 21.6 ticks) is finer
 * than any coarser poll could resolve. Convert a measured span back to seconds with
 * `secondsOf` when the assertion is stated in seconds.
 */
export async function actLaunchTicks(api, { count = 8, max = 240 * TICK } = {}) {
  const ticks = [];
  let launched = 0;
  let t = 0;
  for (let i = 0; i < max && ticks.length < count; i += 1) {
    await api.advance(TICK);
    t += TICK;
    const cur = (await api.snapshot()).cascade.launched;
    if (cur > launched) {
      ticks.push(t);
      launched = cur;
    }
  }
  return { ticks, launched };
}

/**
 * Run the cascade until it reports itself complete (or `max` ticks are spent), and
 * return the final snapshot. Polls a tenth of a second at a time: `done` is
 * constant between the last retirement and the end, so a tick-granular sweep over
 * 40 s of game time would cost thousands of round trips for no extra precision.
 *
 * In the record pass this runs past the clip budget and is cut short, which is
 * correct — the opening of the cascade is what depicts it.
 */
export async function actRunCascadeToDone(api, { max = CASCADE_DONE_MAX } = {}) {
  const { snap } = await api.until((s) => Boolean(s.cascade && s.cascade.done), {
    max,
    poll: SECOND / 10, // 12 ticks
  });
  return snap;
}

/**
 * Let a frame paint the posed scene, then capture a declared image output.
 *
 * The pause is `settle`, not `advance`: a screenshot must read what the build
 * actually DREW, and no amount of simulation stepping produces a painted frame.
 * (This replaces the old `shoot`, whose `api.wait(90)` no longer exists.)
 */
export async function actShoot(api, id, ms = 90) {
  await api.settle(ms);
  await api.screenshot(id);
}

// ---- Table geometry helpers (mirrored from specs/table.md) -----------------
//
// Pure computation over a snapshot — instant, so callable from either phase.

/** The center of a card whose top-left is (x, y). */
export function cardCenter(x, y) {
  return { x: x + CARD_W / 2, y: y + CARD_H / 2 };
}

/** The center of foundation slot `i` in the top row. */
export function foundationCenter(i) {
  return cardCenter(FOUNDATION_X[i], TOP_Y);
}

/** The center of the stock slot. */
export function stockCenter() {
  return cardCenter(STOCK_X, TOP_Y);
}

// The per-column face-up overlap, compressed for long columns exactly as
// layout.faceUpOffset does, so a computed card position matches what is drawn.
export function faceUpOffset(col) {
  if (col.length < 2) return FACE_UP_OFFSET;
  let downGaps = 0;
  let upGaps = 0;
  for (let i = 1; i < col.length; i += 1) {
    if (col[i - 1].faceUp) upGaps += 1;
    else downGaps += 1;
  }
  if (upGaps === 0) return FACE_UP_OFFSET;
  const span =
    COLUMN_BOTTOM_LIMIT - TABLEAU_Y - CARD_H - downGaps * FACE_DOWN_OFFSET;
  let off = Math.min(FACE_UP_OFFSET, span / upGaps);
  if (off < FACE_UP_OFFSET_MIN) off = FACE_UP_OFFSET_MIN;
  return off;
}

/** The y of every card in a column, top-to-bottom (cards carry `faceUp`). */
export function columnCardYs(col) {
  const off = faceUpOffset(col);
  const ys = [];
  let y = TABLEAU_Y;
  for (let i = 0; i < col.length; i += 1) {
    ys.push(y);
    y += col[i].faceUp ? off : FACE_DOWN_OFFSET;
  }
  return ys;
}

/** The top-left of card index `i` in tableau column `col` (cards from snapshot). */
export function tableauCardTopLeft(colIndex, cards, i) {
  const ys = columnCardYs(cards);
  return { x: COLS_X[colIndex], y: ys[i] };
}

/** The center of card index `i` in tableau column `col`. */
export function tableauCardCenter(colIndex, cards, i) {
  const tl = tableauCardTopLeft(colIndex, cards, i);
  return cardCenter(tl.x, tl.y);
}

/**
 * The center of the playable top waste card, from a snapshot. `wasteVisibleCount`
 * is how many cards are fanned (Draw Three fans up to three, Draw One shows one),
 * so the frontmost fanned card is at index `count - 1`.
 */
export function wasteTopCenter(snap) {
  const count = snap.wasteVisibleCount;
  const i = Math.max(0, count - 1);
  return cardCenter(WASTE_X + i * WASTE_FAN, TOP_Y);
}

// ---- Pixel / color sampling (reads the rendered canvas) --------------------
//
// The color checks read the pixels the build actually PAINTS, through the driver's
// `api.pixel(u, v)` — `u`, `v` are fractions across the game canvas — so a logical
// coordinate maps to a fraction by dividing by the field size. Reading the rendered
// pixel (not a color the game reports) means a build cannot pass by returning a
// value it does not draw.
//
// A pixel read needs a PAINTED frame, so precede it with `api.settle(ms)` (a real
// pause in both passes) rather than `api.advance`, which moves simulation time and
// in the validate pass consumes no wall clock at all.

/**
 * Average the rendered color over a small 5-point cluster (center + four neighbors)
 * that stays inside a solid fill, so a stray antialiased edge pixel cannot swing the
 * reading. Returns `{ r, g, b }` (0–255).
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
    const p = await api.pixel((x + dx) / FIELD_W, (y + dy) / FIELD_H);
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
