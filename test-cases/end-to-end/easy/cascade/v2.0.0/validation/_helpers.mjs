// Case-specific helpers for Cascade's automated-validation debug scripts.
//
// Every script here drives the real, deterministic game through window.__cascade
// (see specs/instrumentation.md): control ops only set up PRECONDITIONS (deal a
// board, arrange exact piles, inject pointer input), then the real rules engine
// and the real victory-cascade simulation resolve the outcome, which `snapshot`
// (or `pixel`) reads back. Nothing fabricates a result. These helpers factor out
// the "arrange a board, run the real system, read what happened" patterns, the
// table geometry the pointer-driven scripts need (mirrored from specs/table.md and
// the canonical constants), and the pixel/color sampling.
//
// The assertion primitives are NOT here — they are the reporter-side `ttc` kit the
// driver hands every `drive(api, ttc)` (see packages/browser-driver/ttc.mjs). This
// file holds only what is specific to Cascade.

// ---- Field + table geometry (specs/table.md, specs/overview.md) ------------
export const FIELD_W = 1280;
export const FIELD_H = 720;
export const FIXED = 1 / 120; // victory-cascade timestep (matches FIXED_STEP)

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

// ---- Common drive shapes ---------------------------------------------------

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

/** Let a frame paint the posed scene, then capture a declared image output. */
export async function shoot(api, id) {
  await api.wait(90);
  await api.screenshot(id);
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

// ---- Table geometry helpers (mirrored from specs/table.md) -----------------

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
