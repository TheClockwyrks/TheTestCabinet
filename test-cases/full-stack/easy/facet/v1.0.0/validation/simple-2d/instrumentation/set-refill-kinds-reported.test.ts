// Facet — instrumentation/set-refill-kinds-reported: a posed refill is
// reported by the snapshot as `refillKinds`, one entry per column, and nothing
// else changes.
//
// WHAT THE SPECIFICATION ASKS FOR. specs/instrumentation.md fixes `refillKinds`
// in the snapshot shape — "`GRID_COLS` (`8`) entries whatever the board, each
// the string `setRefillKinds` posed for that column and `""` for a column that
// draws" — and, of `setRefillKinds` itself, that "the board and every other
// column's pose stand where they were, and nothing else changes." The read-back
// is what lets every operation on the surface be verified by setting a value and
// reading it, and it is what a scenario reads to know what it posed.
//
// TWO COLUMNS, NOT ONE. A build that kept a single pose for the whole board
// reports the last one written in every entry, and a build that keyed the pose
// off the wrong index reports it in the wrong entry; two columns posed with two
// different strings tell either apart from a build that keeps eight.
//
// WHAT IS DELIBERATELY LEFT UNASSERTED. What the pose DEALS is
// `instrumentation/set-refill-kinds-deals-the-pose`; that `clearRefillKinds`
// empties every entry is `instrumentation/clear-refill-kinds-clears-every-
// column`; and the resting value of the field is
// `instrumentation/snapshot-resting-values`. This point reads the pose back.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { assertBoardEquals, quietBoard, renderBoard } from "../board";
import { RESTING_REFILL_KINDS } from "../constants";
import {
  captureStill,
  createHarness,
  failSurface,
  loadBoard,
  type Harness,
} from "../harness";

/** Two columns posed with two different strings, and six left to draw. */
const POSES: readonly (readonly [col: number, kinds: string])[] = [
  [2, "RA"],
  [6, "J"],
];

/** What the snapshot reports once both are posed. */
const EXPECTED = RESTING_REFILL_KINDS.map(
  (resting, col) => POSES.find(([at]) => at === col)?.[1] ?? resting,
);

let h: Harness;

function requireSurface(): void {
  if (h.surfaceFault !== null) failSurface(h.surfaceFault);
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reports each column's posed refill under its own index, and changes nothing else", async () => {
  requireSurface();
  const posed = quietBoard();
  const before = loadBoard(h, posed);

  for (const [col, kinds] of POSES) h.debug.setRefillKinds(col, kinds);
  const s = h.snapshot();

  assertDeepEqual(s.refillKinds, EXPECTED, "refillKinds after two poses");

  // "The board and every other column's pose stand where they were, and nothing
  // else changes": the board, the screen, the phase and the round's figures
  // read exactly as they did before the poses.
  assertBoardEquals(
    renderBoard(s),
    renderBoard(before),
    "the board after posing a refill",
  );
  assertEqual(s.screen, before.screen, "the screen after posing a refill");
  assertEqual(s.phase, before.phase, "the phase after posing a refill");
  assertEqual(s.score, before.score, "the score after posing a refill");
  assertEqual(
    s.menuIndex,
    before.menuIndex,
    "the menu index after posing a refill",
  );

  await h.advance(1);
  captureStill(h, "posed");
});
