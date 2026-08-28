// cascade/cascade-starts — choosing CASCADE from the title starts the sequence.
//
// specs/modes/cascade.md "The sequence": starting Cascade from the main menu
// sets `state.mode` to `cascade`, the boards-solved count `solvedCount` to `0`,
// `tier` to `1`, generates the first board, and moves to `playing` with every
// beam empty — and the fields the campaign uses hold the resting values
// `specs/state.md` gives them, which `specs/instrumentation.md`'s resting table
// states: `boardIndex` 0, `solvedBoards` empty, `unlockedCount` 1,
// `selectIndex` 0. Entry goes through the surface's `startMode`, the pose
// `specs/instrumentation.md` defines as "exactly as choosing its menu item
// does", so no build-chosen menu binding is in the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  startCascade,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("CASCADE starts the sequence: playing, solvedCount 0, tier 1, a fresh board", async () => {
  await startCascade(h);
  await captureStill(h, "board");

  const snapshot = await h.snapshot();
  assertEqual(snapshot.mode, "cascade");
  assertEqual(snapshot.screen, "playing");
  assertEqual(snapshot.solvedCount, 0);
  assertEqual(snapshot.tier, 1);

  // A board is present: real dimensions and nodes on them.
  assertGreaterThan(snapshot.board.cols, 0, "a generated board's cols");
  assertGreaterThan(snapshot.board.rows, 0, "a generated board's rows");
  assertGreaterThan(
    snapshot.board.nodes.length,
    0,
    "a generated board's nodes",
  );

  // Every beam empty on arrival.
  for (const [channel, beam] of Object.entries(snapshot.beams)) {
    if (beam === undefined) continue;
    assertDeepEqual(beam.cells, [], `the ${channel} beam arrives empty`);
  }

  // The campaign's fields hold their resting values: entry touched nothing of
  // the other mode's progression.
  assertEqual(snapshot.boardIndex, 0, "campaign boardIndex at rest");
  assertDeepEqual(snapshot.solvedBoards, [], "campaign solvedBoards at rest");
  assertEqual(snapshot.unlockedCount, 1, "campaign unlockedCount at rest");
  assertEqual(snapshot.selectIndex, 0, "campaign selectIndex at rest");
});
