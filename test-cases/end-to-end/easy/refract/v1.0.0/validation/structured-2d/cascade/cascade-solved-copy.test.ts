// Refract — cascade/cascade-solved-copy: the cascade solved screen draws its
// copy over the finished board.
//
// specs/modes/cascade.md "The solved screen": the screen shows
// SOLVED_TITLE_TEXT (BOARD SOLVED), the boards-solved count, and a vertical
// menu of SOLVED_ITEMS (NEXT BOARD, RESTART) in that order — drawn over the
// finished board, which stays visible behind it with every beam complete, so
// the player sees the shape they made. That the solve REACHES that screen at
// all is cascade/cascade-solved-reached's point.
//
// THE WORLD IS POSED, not generated. The scenario enters Cascade for real and
// poses its boards through `loadBoard` — "a board posed this way is a board
// like any other" (specs/instrumentation.md) — so this point stops depending
// on the generator, which the cascade/generated-* and cascade/tier-* points
// decide on their own. The posed board carries
// a filled lens in each of two rows and a whole empty row between them, which
// is the local bench the reading below needs. Two solves put the count at 2,
// so no other figure on the screen (the tier, at 1) can stand in for it.
//
// THE COPY IS READ AS RUNS. A build may letter-space its headings and canvas
// carries no portable property for it, so tracked copy is drawn a glyph per
// `fillText` call; the frame's COALESCED runs are what carry the words, and
// the count is matched as one of the whole numbers a run spells rather than
// as its digits run together.
//
// THE BOARD STAYS DRAWN BEHIND — AND ONLY THAT. The spec's words are that the
// finished board "stays visible behind it ... so the player sees the shape
// they made". What a validator can decide from that is whether the board was
// DRAWN under the overlay at all, rather than erased or hidden behind an
// opaque panel. How strongly it reads through a scrim is the build's own look
// — specs/board.md pins neither a palette nor a background — and belongs to
// the reviewer's domain ratings, not here.
//
// So each LENS centre is compared against an EMPTY CELL of the same board on
// the same frame. Two reasons, both from specs/board.md. Only a lens is
// filled at its centre: an emitter is the outlined silhouette of its channel,
// so a ring legitimately reads bench colour at its exact middle and sampling
// one would demand the reverse of the spec. And under a full-stage scrim of
// alpha `a` a node centre and an empty cell are veiled identically, so what
// is left is the board's own contrast rather than the build's overlay
// opacity; a build that did not draw the board reads exactly 0, because both
// points are then the same veiled pixel. VISIBLE (5 of 441) is the room two
// genuinely different colours still need once a heavy veil has scaled them
// both toward each other.

import { afterEach, beforeEach, it } from "vitest";
import { SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertTrue,
  fail,
} from "../assert";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextRuns,
  drawnTextSpans,
  drewText,
  loadBoard,
  resetTo,
  sampleColor,
  startCascade,
  toCells,
  traceCells,
  type Harness,
  type Rgb,
  type TextSpan,
} from "../harness";
import { BOARD_CX, BOARD_CY, cellCenter, NODE_R } from "../notation";
import { numbersIn } from "./helpers";

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

/** Two boards solved: the count on the screen under test. */
const SOLVES = 2;
/** Two colours this far apart of 441 are two colours, not one under a veil. */
const VISIBLE = 5;

/** Draw one route through `trace`, as `traceBeams` draws a solver's beam. */
function traceRoute(
  h: Harness,
  route: readonly (readonly [number, number])[],
): void {
  traceCells(h, toCells(route));
}

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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the title, the count, and the menu in order over the finished board", async () => {
  await resetTo(h, 1);
  await startCascade(h);

  // One quick posed solve, so the count on the screen under test is 2.
  await loadBoard(h, GEO_3X3);
  traceRoute(h, GEO_3X3_ROUTE);
  assertEqual(h.snapshot().screen, "solved", "the first posed board solves");

  // The board under test, solved channel by channel.
  const board = await loadBoard(h, TWO_ROWS);
  traceRoute(h, TRIANGLE_ROW);
  traceRoute(h, SQUARE_ROW);

  const snapshot = h.snapshot();
  assertEqual(
    snapshot.screen,
    "solved",
    "precondition: the solve reaches the solved screen " +
      "(see cascade-solved-reached)",
  );
  assertEqual(snapshot.solvedCount, SOLVES, "both solves are counted");

  // One more frame of the same screen, so the calls read are its alone.
  h.calls.length = 0;
  await h.advance(1);
  // The solved screen over the finished board.
  captureStill(h, "solved");
  assertEqual(h.snapshot().screen, "solved", "the solved screen holds");

  // The screen's copy: the heading, the count, and the menu in its order.
  assertTrue(
    drewText(h.calls, SOLVED_TITLE_TEXT),
    `the frame draws ${JSON.stringify(SOLVED_TITLE_TEXT)}`,
  );
  const runs = drawnTextRuns(h);
  assertTrue(
    runs.some((run) => numbersIn(run).includes(SOLVES)),
    `the frame draws the boards-solved count, ${SOLVES}`,
  );
  const itemRuns = SOLVED_ITEMS.map((item) => {
    const found = runs.find((run) =>
      run.text.toLowerCase().includes(item.toLowerCase()),
    );
    if (found === undefined) {
      fail(
        `the frame draws ${JSON.stringify(item)} (specs/modes/cascade.md: ` +
          `the solved screen's menu)`,
        runs.map((run) => run.text),
      );
    }
    return found;
  });
  assertLessThan(
    itemRuns[0].y,
    itemRuns[1].y,
    `${SOLVED_ITEMS[0]} above ${SOLVED_ITEMS[1]}: the vertical menu in order`,
  );

  // The finished board stays drawn behind: on the solved frame itself, each
  // lens centre reads against an EMPTY CELL of the same board on the same
  // frame — the local bench, veiled by whatever the overlay laid over both.
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
      const at = cellCenter(col, row, board.cols, board.rows);
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
    const at = cellCenter(node.col, node.row, board.cols, board.rows);
    if (!clear(at.x, at.y)) continue;
    sampled += 1;
    assertGreaterThan(
      colorDistance(sampleColor(h, at.x, at.y), bench),
      VISIBLE,
      `the ${String(node.channel)} lens at (${node.col}, ${node.row}) is ` +
        `drawn behind the solved screen — read against the board's own ` +
        `empty cell ${benchAt} on the same frame ` +
        "(specs/modes/cascade.md: the finished board stays visible behind it)",
    );
  }
  assertGreaterThan(
    sampled,
    0,
    "the board carries a lens centre clear of the overlay's copy to sample",
  );
});
