// Refract — cascade/cascade-starts: choosing CASCADE from the title starts
// the sequence.
//
// specs/modes/cascade.md "The sequence": starting Cascade from the main menu
// sets state.mode to cascade, sets solvedCount to 0, sets tier to 1, generates
// the first board, and moves to playing with every beam empty — and the fields
// the campaign uses hold the resting values specs/state.md gives them
// (boardIndex 0, solvedBoards empty, unlockedCount 1, selectIndex 0).
//
// The entry is the REAL path a player takes: `down` to the title menu's second
// item and `confirm` (specs/ui.md: CASCADE is TITLE_ITEMS[1] and the title
// menu is keyboard only), so what is checked is the wired menu, not a posed
// state.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  startCascade,
  type Harness,
} from "../harness";
import { assertEveryBeamEmpty } from "./helpers";

const SEED = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts the sequence on CASCADE: playing, count 0, tier 1, a fresh board", async () => {
  await startCascade(h, SEED);
  // The first generated board, as the frame that landed it drew it.
  captureStill(h, "board");

  const snapshot = h.snapshot();
  assertEqual(snapshot.mode, "cascade", "CASCADE sets the mode");
  assertEqual(snapshot.screen, "playing", "the sequence opens on playing");
  assertEqual(snapshot.solvedCount, 0, "solvedCount opens at 0");
  assertEqual(snapshot.tier, 1, "tier opens at 1");

  assertGreaterThanOrEqual(snapshot.board.cols, 1, "a board is present: cols");
  assertGreaterThanOrEqual(snapshot.board.rows, 1, "a board is present: rows");
  assertGreaterThan(
    snapshot.board.nodes.length,
    0,
    "a board is present: nodes",
  );
  assertEveryBeamEmpty(
    snapshot,
    "the first board arrives with every beam empty",
  );

  // The campaign's fields at their resting values (specs/state.md).
  assertEqual(snapshot.boardIndex, 0, "boardIndex rests at 0");
  assertDeepEqual(snapshot.solvedBoards, [], "solvedBoards rests empty");
  assertEqual(snapshot.unlockedCount, 1, "unlockedCount rests at 1");
  assertEqual(snapshot.selectIndex, 0, "selectIndex rests at 0");
});
