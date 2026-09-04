// Refract — cascade/solved-screen: the cascade solved screen.
//
// specs/modes/cascade.md "The solved screen": solving a board moves to
// `solved` with menuIndex 0, showing SOLVED_TITLE_TEXT (BOARD SOLVED), the
// boards-solved count, and a vertical menu of SOLVED_ITEMS (NEXT BOARD,
// RESTART) in that order — drawn over the finished board, which stays visible
// behind it with every beam complete, so the player sees the shape they made.
//
// HOW "STAYS DRAWN BEHIND" IS SAMPLED. The spec fixes visibility, not pixels:
// the screen is DRAWN OVER the board, so a build may quiet the bench under it
// (the reference dims it uniformly), and holding node-center pixels equal to
// the playing frame's would fail builds the spec permits. What every
// conformant solved frame must show is the board itself still drawn at its
// cell centers: on a solved board every node lies on a complete beam
// (specs/beams.md R6-R9 route every channel's beam through its emitters and
// lenses and spend every crystal), so each node center — placed by the cell
// center formula in specs/board.md — must read distinct from the same frame's
// bare bench. The centers are sampled against the frame's own background
// patch, distinct meaning an RGB distance beyond 25 of 441, the checklist's
// room for indistinguishable color; a build that blanked or erased the board
// behind the screen reads bench everywhere and fails.

import { afterEach, beforeEach, it } from "vitest";
import { SOLVED_ITEMS, SOLVED_TITLE_TEXT } from "../constants";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  assertTrue,
  fail,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  drawnTextSpans,
  drewText,
  sampleBackground,
  sampleColor,
  solveGenerated,
  type Harness,
} from "../harness";
import { cellCenter } from "../notation";
import { digitsOf } from "./helpers";

const SEED = 1;
/** Five real solves; the fifth board is the finished one behind the screen. */
const SOLVES = 5;
/** Beyond the RGB room the checklist reads as indistinguishable (25 of 441). */
const DISTINCT_DISTANCE = 25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("shows the solved screen over the finished board, which stays drawn", async () => {
  const solved = await solveGenerated(h, SOLVES, SEED);
  const board = solved[SOLVES - 1].board;

  const snapshot = h.snapshot();
  assertEqual(snapshot.screen, "solved", "solving moves to solved");
  assertEqual(snapshot.menuIndex, 0, "menuIndex is 0 on arriving at solved");
  assertEqual(snapshot.solvedCount, SOLVES, "the solve is counted");
  for (const [channel, beam] of Object.entries(snapshot.beams)) {
    assertEqual(
      beam?.complete,
      true,
      `the ${channel} beam stays complete behind the screen`,
    );
  }

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
  const spans = drawnTextSpans(h);
  assertTrue(
    spans.some((span) => digitsOf(span) === SOLVES),
    `the frame draws the boards-solved count, ${SOLVES}`,
  );
  const itemSpans = SOLVED_ITEMS.map((item) => {
    const found = spans.find((span) =>
      span.text.toLowerCase().includes(item.toLowerCase()),
    );
    if (found === undefined) {
      fail(
        `the frame draws ${JSON.stringify(item)} (specs/modes/cascade.md: ` +
          `the solved screen's menu)`,
        spans.map((span) => span.text),
      );
    }
    return found;
  });
  assertLessThan(
    itemSpans[0].y,
    itemSpans[1].y,
    `${SOLVED_ITEMS[0]} above ${SOLVED_ITEMS[1]}: the vertical menu in order`,
  );

  // The finished board stays drawn behind: every node center reads distinct
  // from the same frame's bare bench.
  const background = sampleBackground(h);
  for (const node of board.nodes) {
    const at = cellCenter(node.col, node.row, board.cols, board.rows);
    assertGreaterThan(
      colorDistance(sampleColor(h, at.x, at.y), background),
      DISTINCT_DISTANCE,
      `the ${node.kind} at (${node.col}, ${node.row}) stays drawn behind ` +
        `the solved screen`,
    );
  }
});
