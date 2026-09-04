// cascade/solved-screen — the cascade solved screen.
//
// specs/modes/cascade.md "The solved screen": on solving, the game moves to
// `solved` with `menuIndex` 0; the screen shows SOLVED_TITLE_TEXT
// (BOARD SOLVED), the boards-solved count, and a vertical menu of SOLVED_ITEMS
// (NEXT BOARD, RESTART) in that order; and it "is drawn over the finished
// board, which stays visible behind it with every beam complete, so the player
// sees the shape they made."
//
// THE WORLD IS POSED, not generated. The scenario enters Cascade for real and
// poses its boards through `loadBoard` — "a board posed this way is a board
// like any other" (specs/instrumentation.md) — so this point stops depending
// on the generator, which cascade/boards-are-well-formed and
// cascade/tier-shapes-the-board decide on their own. The posed board carries a
// filled lens in each of two rows and a whole empty row between them, which is
// the local bench the reading below needs. Two solves put the count at 2, so no
// other figure on the screen (the tier, at 1) can stand in for it.
//
// THE COPY IS READ AS RUNS. A build may letter-space its headings and canvas
// carries no portable property for it, so tracked copy is drawn a glyph per
// `fillText` call; the frame's COALESCED runs are what carry the words, and the
// count is matched as one of the whole numbers a run spells rather than as its
// digits run together.
//
// THE BOARD STAYS DRAWN BEHIND — AND ONLY THAT. The item's description asks for
// the finished board still visible; the spec's own words are that it "stays
// visible behind it ... so the player sees the shape they made". What a
// validator can decide from that is whether the board was DRAWN under the
// overlay at all, rather than erased or hidden behind an opaque panel. How
// strongly it reads through a scrim is the build's own look — specs/board.md
// pins neither a palette nor a background — and belongs to the reviewer's
// domain ratings, not here.
//
// So each LENS centre is compared against an EMPTY CELL of the same board on
// the same frame. Two reasons, both from specs/board.md. Only a lens is filled
// at its centre: an emitter is the outlined silhouette of its channel, so a
// ring legitimately reads bench colour at its exact middle and sampling one
// would demand the reverse of the spec. And under a full-stage scrim of alpha
// `a` a node centre and an empty cell are veiled identically, so what is left
// is the board's own contrast rather than the build's overlay opacity; a build
// that did not draw the board reads exactly 0, because both points are then the
// same veiled pixel. VISIBLE (5 of 441) is the room two genuinely different
// colours still need once a heavy veil has scaled them both toward each other.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNotNull,
  assertTrue,
  fail,
} from "../assert";
import { SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import { GEO_3X3 } from "../fixtures";
import { BOARD_CX, BOARD_CY, cellCenter, NODE_R } from "../notation";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextRuns,
  drewText,
  loadBoard,
  sampleColor,
  startCascade,
  textDraws,
  traceRoute,
  type Harness,
  type Rgb,
  type TextDraw,
} from "../harness";

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

/**
 * Whether a drawn text run plausibly covers the point: within the run's
 * horizontal extent widened by NODE_R, and within 48 logical units of its
 * anchor line — a generous allowance for glyph height, since the case fixes no
 * font. Points a run covers are skipped rather than compared: the item is about
 * the overlay leaving the board visible, not where the build put its copy, and
 * a pixel under a glyph reads the copy's colour instead of the board's. Read
 * off the RAW draws rather than the coalesced runs, because the finer extents
 * skip the fewest points.
 */
function covered(draw: TextDraw, x: number, y: number): boolean {
  return (
    x >= draw.left - NODE_R &&
    x <= draw.right + NODE_R &&
    Math.abs(y - draw.y) <= 48
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solving goes to solved, draws the copy, and keeps the board behind", async () => {
  await startCascade(h);

  // One quick posed solve, so the count on the screen under test is 2.
  await loadBoard(h, GEO_3X3);
  await traceRoute(h, GEO_3X3_ROUTE);
  assertEqual(
    (await h.snapshot()).screen,
    "solved",
    "the first posed board solves",
  );

  // The board under test, solved channel by channel.
  const board = await loadBoard(h, TWO_ROWS);
  await traceRoute(h, TRIANGLE_ROW);
  await traceRoute(h, SQUARE_ROW);

  const solved = await h.snapshot();
  assertEqual(solved.screen, "solved", "solving moves to solved");
  assertEqual(solved.menuIndex, 0, "menuIndex on arriving at solved");
  assertEqual(solved.solvedCount, SOLVES, "both solves are counted");

  // The finished board behind it has every beam complete.
  for (const [channel, beam] of Object.entries(solved.beams)) {
    if (beam === undefined) continue;
    assertEqual(beam.complete, true, `the ${channel} beam behind the screen`);
  }

  // The frame that draws it.
  const calls = await h.frameCalls();
  await captureStill(h, "solved");

  const runs = drawnTextRuns(calls);
  assertTrue(
    drewText(calls, SOLVED_TITLE_TEXT),
    `the frame draws ${JSON.stringify(SOLVED_TITLE_TEXT)}`,
  );
  assertTrue(
    runs.some((run) =>
      (run.text.match(/\d+/g) ?? []).some(
        (d) => Number.parseInt(d, 10) === SOLVES,
      ),
    ),
    `the frame draws the boards-solved count, ${SOLVES}`,
  );

  // The vertical menu, in SOLVED_ITEMS order: NEXT BOARD above RESTART.
  const anchorOf = (item: string): TextDraw | null =>
    runs.find((run) => run.text.toLowerCase().includes(item.toLowerCase())) ??
    null;
  const nextBoard = anchorOf(SOLVED_ITEMS[0]);
  const restart = anchorOf(SOLVED_ITEMS[1]);
  assertNotNull(nextBoard, `a ${SOLVED_ITEMS[0]} menu entry`);
  assertNotNull(restart, `a ${SOLVED_ITEMS[1]} menu entry`);
  if (nextBoard !== null && restart !== null) {
    assertGreaterThan(
      restart.y,
      nextBoard.y,
      `${SOLVED_ITEMS[0]} sits above ${SOLVED_ITEMS[1]}`,
    );
  }

  // The finished board stays drawn behind: on this same frame, each lens
  // centre reads against an EMPTY CELL of the same board — the local bench,
  // veiled by whatever the overlay laid over both.
  const draws = textDraws(calls);
  const clear = (x: number, y: number): boolean =>
    !draws.some((draw) => covered(draw, x, y));
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
    benchCell === null ? null : await sampleColor(h, benchCell.x, benchCell.y);
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
      colorDistance(await sampleColor(h, at.x, at.y), bench),
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
