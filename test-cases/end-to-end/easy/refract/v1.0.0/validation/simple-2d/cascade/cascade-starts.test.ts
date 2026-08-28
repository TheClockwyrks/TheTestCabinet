// Refract — cascade/cascade-starts: choosing CASCADE from the title starts
// the sequence.
//
// specs/modes/cascade.md "The sequence": starting Cascade from the main menu
// sets `mode` to `cascade`, sets `solvedCount` to 0 and `tier` to 1, generates
// the first board, and moves to `playing` with every beam empty — and the
// fields the campaign uses hold the resting values specs/state.md gives them
// (boardIndex 0, solvedBoards empty, unlockedCount 1, selectIndex 0). The
// entry is driven the way a player makes it: one `down` from CAMPAIGN to
// CASCADE on the title menu, then `confirm`, through the registered actions.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startCascade,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("starts the sequence: mode cascade, playing, fresh progression, campaign at rest", async () => {
  await resetTo(h);
  await startCascade(h);
  captureStill(h, "board");

  const snapshot = h.snapshot();
  assertEqual(snapshot.mode, "cascade", "CASCADE sets mode to cascade");
  assertEqual(snapshot.screen, "playing", "CASCADE goes to playing");
  assertEqual(snapshot.solvedCount, 0, "solvedCount opens at 0");
  assertEqual(snapshot.tier, 1, "tier opens at 1");

  // The first board is generated and present.
  assertGreaterThan(
    snapshot.board.nodes.length,
    0,
    "a generated board is present (specs/modes/cascade.md)",
  );

  // Every beam is empty: the board arrives undrawn.
  for (const [channel, beam] of Object.entries(snapshot.beams)) {
    assertEqual(
      beam.cells.length,
      0,
      `the ${channel} beam is empty on arrival`,
    );
  }

  // The campaign's fields hold their resting values
  // (specs/instrumentation.md resting-values table).
  assertEqual(snapshot.boardIndex, 0, "boardIndex rests at 0 in Cascade");
  assertDeepEqual(
    snapshot.solvedBoards,
    [],
    "solvedBoards rests empty in Cascade",
  );
  assertEqual(snapshot.unlockedCount, 1, "unlockedCount rests at 1 in Cascade");
  assertEqual(snapshot.selectIndex, 0, "selectIndex rests at 0 in Cascade");
});
