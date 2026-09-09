// cascade/cascade-starts — choosing CASCADE from the title starts the sequence.
//
// specs/modes/cascade.md "The sequence": starting Cascade from the main menu
// sets `state.mode` to `cascade`, the boards-solved count `solvedCount` to `0`,
// `tier` to `1`, generates the first board, and moves to `playing` with every
// beam empty — and changes no field the campaign uses, so from the fresh reset
// the harness opens on those hold the resting values `specs/instrumentation.md`
// tables: `boardIndex` 0, `solvedBoards` empty, `unlockedCount` 1,
// `selectIndex` 0. Whether campaign progress survives the entry is
// campaign/campaign-progress-persists's question. The choice is really made,
// since starting the sequence is
// what this point decides: CASCADE is `TITLE_ITEMS[1]`, so the title's `menu-1`
// pointer target is pressed and released at its center, which specs/controls.md
// fixes as "the same as `confirm` with `state.menuIndex` at `i`". The pointer
// rather than a key: the target ids are the specification's, while the menu's
// key bindings are the build's own under this engine.

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

  // The campaign's fields, untouched by the entry: at their resting values,
  // since nothing in this session has moved them (specs/instrumentation.md).
  assertEqual(snapshot.boardIndex, 0, "campaign boardIndex at rest");
  assertDeepEqual(snapshot.solvedBoards, [], "campaign solvedBoards at rest");
  assertEqual(snapshot.unlockedCount, 1, "campaign unlockedCount at rest");
  assertEqual(snapshot.selectIndex, 0, "campaign selectIndex at rest");
});
