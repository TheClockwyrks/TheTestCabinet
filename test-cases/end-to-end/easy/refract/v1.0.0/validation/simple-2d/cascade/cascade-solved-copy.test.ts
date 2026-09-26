// Refract — cascade/cascade-solved-copy: the cascade solved screen draws its
// copy over the finished board.
//
// specs/modes/cascade.md "The solved screen": `solved` is drawn over the
// finished board, which stays visible behind it; it shows SOLVED_TITLE_TEXT
// (BOARD SOLVED), the boards-solved count, and a vertical menu of
// SOLVED_ITEMS (NEXT BOARD, RESTART) in that order. That the solve REACHES
// that screen at all is cascade/cascade-solved-reached's point.
//
// The scenario enters Cascade for real and poses boards through
// `loadBoard` — "a board posed this way is a board like any other"
// (specs/instrumentation.md) — so solving one moves to the cascade `solved`
// screen. Two solves put the count at 2, so no other figure on the screen
// (the tier, at 1) can stand in for it.
//
// THE COPY IS READ AS RUNS. A build may letter-space its headings and canvas
// carries no portable property for it, so tracked copy is drawn a glyph per
// `fillText` call; the frame's COALESCED runs are what carry the words. The
// title and each menu entry are matched by the package's `drewText` —
// ignoring case, with the whitespace folded out of both sides along a
// baseline — and the count is matched as one of the numbers a run spells
// rather than as its digits run together, and a figure the build groups with
// a thousands separator spells the one figure it reads as. The menu's ORDER
// is then read off the placed runs, each entry taken from a run that spells
// it under the same fold.
//
// THE BOARD STAYS DRAWN BEHIND — AND ONLY THAT. The spec's words are that the
// finished board "stays visible behind it ... so the player sees the shape
// they made". What a validator can decide from that is whether the board was
// DRAWN under the overlay at all, rather than erased or hidden behind an
// opaque panel. How strongly it reads through a scrim is the build's own look
// — specs/board.md pins neither a palette nor a background — and belongs to
// the reviewer's domain ratings, not here.
//
// So each lens centre — the lens is the node whose form FILLS its centre
// (specs/board.md; an emitter is outlined and open there, so its centre is
// legitimately bench-coloured) — is compared against AN EMPTY CELL OF THE
// SAME BOARD ON THE SAME FRAME, never against a stage-edge patch. Under a
// full-stage scrim of alpha `a` both readings are veiled identically, so what
// is left is the board's own contrast rather than the build's overlay
// opacity; a build that did not draw the board reads exactly 0, because both
// points are then the same veiled pixel. So the reading is that the two points
// differ AT ALL: how strongly the board reads through a scrim is the build's
// own look, and whether it reads well is the reviewer's to judge.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  fail,
} from "../assert";
import { SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextRuns,
  drawnTextSpans,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleColor,
  startCascade,
  traceRoute,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";
import { drewText } from "../case-harness/text";
import { BOARD_CX, BOARD_CY, NODE_R, parseBoard } from "../notation";

/** The forced GEO_3X3 solve: T(0,0) — t(1,1) — T(2,2) (fixtures.ts). */
const GEO_3X3_ROUTE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 2],
];

/**
 * The board under test: two channels, one across the top row and one across
 * the bottom row of a full-width grid (specs/board.md notation), each with a
 * filled lens between its two emitters. The wide empty field beside and
 * between them is what this reading needs — a build's overlay copy is drawn
 * about the stage's centre, so the grid's far corners are empty cells the copy
 * does not reach, and one of them is the local bench each lens is read
 * against.
 */
const TWO_ROWS = `
TtT....
.......
.......
.......
SsS....
`;
const TRIANGLE_ROW: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
];
const SQUARE_ROW: readonly (readonly [number, number])[] = [
  [0, 4],
  [1, 4],
  [2, 4],
];

/**
 * Whether a drawn text run plausibly covers the point: within the run's
 * horizontal extent widened by NODE_R, and within 48 logical units of its
 * anchor line — a generous allowance for glyph height, since the case fixes
 * no font. Points a run covers are skipped rather than compared: the item is
 * about the overlay leaving the board visible, not where the build put its
 * copy, and a pixel under a glyph reads the copy's colour instead of the
 * board's. Read off the RAW draws rather than the coalesced runs, because the
 * finer extents skip the fewest points.
 */
function covered(span: TextSpan, x: number, y: number): boolean {
  return (
    x >= span.left - NODE_R &&
    x <= span.right + NODE_R &&
    Math.abs(y - span.y) <= 48
  );
}

/**
 * Group separators a build may draw between a figure's digit triples: the
 * comma, the apostrophe, and the no-break, narrow no-break and thin spaces
 * `Number.prototype.toLocaleString` reaches for. A figure drawn with them
 * reads as the one figure it spells, because the specification fixes the VALUE
 * and leaves how that figure is presented to the build.
 *
 * ASCII space is deliberately absent from the set: a frame's text is assembled
 * by joining separate draw runs with one, so accepting it would read the two
 * figures in `"40 130"` as the single number 40130. The full stop is absent for
 * a reason of its own — it is the decimal point, and a build drawing `"1.5"`
 * means one and a half.
 */
const GROUP = "[,'\\u00A0\\u202F\\u2009]";

/** One drawn number: a grouped figure, or a plain one. */
const DRAWN = new RegExp(
  `-?\\d{1,3}(?:${GROUP}\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?`,
  "g",
);

/** The separators themselves, stripped out of a figure once matched whole. */
const SEPARATORS = new RegExp(GROUP, "g");

/**
 * The numbers a run of text carries, in order. `cascade/hud` takes the same
 * reading off a whole span, for the HUD items; this suite has the run's text
 * in hand and reads that.
 */
function numbersIn(text: string): number[] {
  return (text.match(DRAWN) ?? []).map((figure) =>
    Number(figure.replace(SEPARATORS, "")),
  );
}

/** Copy as the package's `drewText` reads it: upper case, whitespace out. */
function fold(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws BOARD SOLVED, the count, and the menu in order, over the finished board", async () => {
  await resetTo(h);
  await startCascade(h);

  // One quick posed solve, so the count on the screen under test is 2.
  await loadBoard(h, GEO_3X3);
  traceRoute(h, GEO_3X3_ROUTE);
  assertEqual(h.snapshot().screen, "solved", "the first posed board solves");

  // The board under test, solved channel by channel.
  await loadBoard(h, TWO_ROWS);
  traceRoute(h, TRIANGLE_ROW);
  traceRoute(h, SQUARE_ROW);
  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "solved",
    "precondition: the solve reaches the solved screen " +
      "(see cascade-solved-reached)",
  );
  assertEqual(snapshot.solvedCount, 2, "two boards are recorded solved");

  h.calls.length = 0;
  await h.advance(1);
  captureStill(h, "solved");

  // The frame draws the title, the count, and both menu items in order.
  assertEqual(
    drewText(h.calls, SOLVED_TITLE_TEXT),
    true,
    `the solved frame draws SOLVED_TITLE_TEXT (${SOLVED_TITLE_TEXT})`,
  );
  const runs = drawnTextRuns(h);
  const countRuns = runs.filter((run) => numbersIn(run.text).includes(2));
  assertGreaterThan(
    countRuns.length,
    0,
    "the solved frame draws the boards-solved count (2)",
  );
  for (const item of SOLVED_ITEMS) {
    if (!drewText(h.calls, item)) {
      fail(
        `the solved frame draws ${JSON.stringify(item)} ` +
          "(specs/modes/cascade.md: the solved screen's menu)",
        runs.map((run) => run.text),
      );
    }
  }
  const itemRuns = SOLVED_ITEMS.map((item) => {
    const wanted = fold(item);
    const found = runs.find((run) => fold(run.text).includes(wanted));
    if (found === undefined) {
      fail(
        `a placed draw of ${JSON.stringify(item)}, to read the menu's order`,
        runs.map((run) => run.text),
      );
    }
    return found;
  });
  assertLessThan(
    itemRuns[0].y,
    itemRuns[1].y,
    "NEXT BOARD is drawn above RESTART: the vertical menu keeps the " +
      "SOLVED_ITEMS order (specs/modes/cascade.md)",
  );

  // The finished board stays drawn behind: on the solved frame itself, each
  // lens centre reads against an EMPTY CELL of the same board on the same
  // frame — the local bench, veiled by whatever the overlay laid over both.
  const board = parseBoard(TWO_ROWS);
  const spans = drawnTextSpans(h);
  const clear = (x: number, y: number): boolean =>
    !spans.some((span) => covered(span, x, y));
  const occupied = new Set(
    board.nodes.map((node) => `${node.col},${node.row}`),
  );

  const emptyCells: { col: number; row: number; x: number; y: number }[] = [];
  for (let row = 0; row < board.rows; row += 1) {
    for (let col = 0; col < board.cols; col += 1) {
      if (occupied.has(`${col},${row}`)) continue;
      const at = nodeCenter(col, row, board.cols, board.rows);
      emptyCells.push({ col, row, x: at.x, y: at.y });
    }
  }
  // Farthest from the grid's centre first: a build's overlay copy is drawn
  // about (BOARD_CX, BOARD_CY), so the outermost empty cell is the one least
  // likely to be under a glyph.
  emptyCells.sort(
    (a, b) =>
      Math.hypot(b.x - BOARD_CX, b.y - BOARD_CY) -
      Math.hypot(a.x - BOARD_CX, a.y - BOARD_CY),
  );
  const benchCell = emptyCells.find((cell) => clear(cell.x, cell.y)) ?? null;
  const bench: Rgb | null =
    benchCell === null ? null : sampleColor(h, benchCell.x, benchCell.y);
  const benchAt =
    benchCell === null ? "" : `(${benchCell.col}, ${benchCell.row})`;
  if (bench === null) {
    fail(
      "an empty cell of the posed board clear of the overlay's copy, to " +
        "read the board's own bench from on this frame",
      runs.map((run) => run.text),
    );
  }

  let sampled = 0;
  for (const node of board.nodes) {
    if (node.kind !== "lens") continue;
    const at = nodeCenter(node.col, node.row, board.cols, board.rows);
    if (!clear(at.x, at.y)) continue;
    sampled += 1;
    assertGreaterThan(
      colorDistance(sampleColor(h, at.x, at.y), bench),
      0,
      `the ${String(node.channel)} lens at (${node.col}, ${node.row}) is ` +
        `drawn behind the solved screen — read against the board's own ` +
        `empty cell ${benchAt} on the same frame ` +
        "(specs/modes/cascade.md: the finished board stays visible behind it)",
    );
  }
  assertGreaterThan(
    sampled,
    0,
    "at least one lens centre sits clear of the overlay's copy",
  );
});
