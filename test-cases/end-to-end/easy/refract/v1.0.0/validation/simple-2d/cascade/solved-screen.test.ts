// Refract — cascade/solved-screen: the cascade solved screen.
//
// specs/modes/cascade.md "The solved screen": `solved` is drawn over the
// finished board, which stays visible behind it; it shows SOLVED_TITLE_TEXT
// (BOARD SOLVED), the boards-solved count, and a vertical menu of
// SOLVED_ITEMS (NEXT BOARD, RESTART) in that order, with `menuIndex` 0 on
// arrival. The scenario enters Cascade for real and poses boards through
// `loadBoard` — a posed board is a board like any other, so solving it moves
// to the cascade `solved` screen. Two solves put the count at 2, so no other
// digit on the bench (the tier, at 1) can stand in for it.
//
// THE BOARD STAYS DRAWN BEHIND. The spec's own words are that the finished
// board "stays visible behind it", and a translucent overlay that dims the
// stage evenly keeps it visible — so what is decidable is VISIBILITY on the
// solved frame itself, not pixel equality against an earlier frame. (The
// item's "sampled node centers unchanged" phrasing is stricter than the spec
// it restates: a conformant scrim changes every pixel while leaving the board
// plainly visible, so this check asserts the spec's claim; the mismatch is
// flagged to the case's maintainers.) Each lens center — the lens is the node
// whose form FILLS its center (specs/board.md; an emitter is open there) —
// must still read against the solved frame's own background sample by more
// than 50 of 441, the checklist's own board-visibility figure, skipping any
// center a drawn text run of the overlay covers.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLessThan } from "../assert";
import { SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import { GEO_3X3 } from "../fixtures";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextSpans,
  drewText,
  loadBoard,
  nodeCenter,
  resetTo,
  sampleBackground,
  sampleColor,
  startCascade,
  traceRoute,
  type Harness,
  type TextSpan,
} from "../harness";
import { NODE_R, parseBoard } from "../notation";

/** The forced GEO_3X3 solve: T(0,0) — t(1,1) — T(2,2) (fixtures.ts). */
const GEO_3X3_ROUTE: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 1],
  [2, 2],
];

/**
 * The board under test: two channels in separate rows (specs/board.md
 * notation), each with a filled lens mid-row to sample the finished board by.
 */
const TWO_ROWS = `
TtT
...
SsS
`;
const TRIANGLE_ROW: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [2, 0],
];
const SQUARE_ROW: readonly (readonly [number, number])[] = [
  [0, 2],
  [1, 2],
  [2, 2],
];

/**
 * Whether a drawn text run plausibly covers the point: within the run's
 * horizontal extent widened by NODE_R, and within 48 logical units of its
 * anchor line — a generous allowance for glyph height, since the case fixes
 * no font. Centers a run covers are skipped rather than compared: the item is
 * about the overlay leaving the board visible, not where the build put its
 * copy.
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

it("draws BOARD SOLVED, the count, and the menu in order, over the finished board", async () => {
  await resetTo(h, 1);
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
    "solving a board goes to solved (specs/modes/cascade.md)",
  );
  assertEqual(snapshot.menuIndex, 0, "menuIndex is 0 on arriving at solved");
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
  const spans = drawnTextSpans(h);
  const countRuns = spans.filter(
    (span) => Number.parseInt(span.text.replace(/\D/g, ""), 10) === 2,
  );
  assertGreaterThan(
    countRuns.length,
    0,
    "the solved frame draws the boards-solved count (2)",
  );
  const lower = (text: string): string => text.toLowerCase();
  const next = spans.find((span) =>
    lower(span.text).includes(lower(SOLVED_ITEMS[0])),
  );
  const restart = spans.find((span) =>
    lower(span.text).includes(lower(SOLVED_ITEMS[1])),
  );
  if (next === undefined || restart === undefined) {
    assertEqual(
      [next?.text, restart?.text],
      SOLVED_ITEMS,
      "the solved frame draws both SOLVED_ITEMS (NEXT BOARD, RESTART)",
    );
    return;
  }
  assertLessThan(
    next.y,
    restart.y,
    "NEXT BOARD is drawn above RESTART: the vertical menu keeps the " +
      "SOLVED_ITEMS order (specs/modes/cascade.md)",
  );

  // The finished board stays drawn behind: on the solved frame itself, each
  // lens center clear of the overlay's text runs still reads against the
  // frame's own background by more than 50 of 441.
  const board = parseBoard(TWO_ROWS);
  const background = sampleBackground(h);
  let sampled = 0;
  for (const node of board.nodes) {
    if (node.kind !== "lens") continue;
    const center = nodeCenter(node.col, node.row, board.cols, board.rows);
    if (spans.some((span) => covered(span, center.x, center.y))) continue;
    sampled += 1;
    assertGreaterThan(
      colorDistance(sampleColor(h, center.x, center.y), background),
      50,
      `the ${String(node.channel)} lens at (${node.col}, ${node.row}) stays ` +
        "visible behind the solved screen (specs/modes/cascade.md)",
    );
  }
  assertGreaterThan(
    sampled,
    0,
    "at least one lens center sits clear of the overlay's text runs",
  );
});
