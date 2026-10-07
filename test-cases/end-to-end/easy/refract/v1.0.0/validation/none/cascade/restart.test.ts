// cascade/restart — RESTART drops the run to tier 1.
//
// specs/modes/cascade.md's solved-screen table: RESTART "returns
// state.solvedCount to 0 and state.tier to 1, generates a board, and moves to
// playing" — read after a second solve, so the 0 and the 1 are a genuine drop
// rather than the values the run already held. The run is posed at one solve
// through `setSolvedCount` and `setTier` (specs/instrumentation.md) and a
// posed board is solved for the second, which lands on the solved screen the
// way a player's solve does. The item is chosen the way a player chooses it:
// `menuIndex` is 0 on arriving at solved, one `down` moves it to RESTART, and
// `confirm` takes it. The board RESTART generates is read for tier 1's channel
// count, which is what "generates a board" at tier 1 means.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { TIERS, channelsPresent } from "../notation";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  fireAction,
  poseCascadeRun,
  solvePosedBoard,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("RESTART after a second solve returns to solvedCount 0, tier 1, a fresh tier-1 board", async () => {
  await poseCascadeRun(h, 1);
  const arrived = await solvePosedBoard(h);
  assertEqual(arrived.solved, true, "precondition: the posed board solves");
  assertEqual(
    arrived.screen,
    "solved",
    "precondition: on the solved screen (see cascade-solved-reached)",
  );
  assertEqual(arrived.solvedCount, 2, "precondition: two boards solved");

  // NEXT BOARD is highlighted on arrival; one down reaches RESTART.
  await fireAction(h, "down");
  const highlighted = await h.snapshot();
  assertEqual(
    highlighted.menuIndex,
    1,
    "precondition: down highlights RESTART",
  );
  await fireAction(h, "confirm");
  await captureStill(h, "restarted");

  const restarted = await h.snapshot();
  assertEqual(restarted.screen, "playing", "RESTART moves to playing");
  assertEqual(restarted.solvedCount, 0, "RESTART returns solvedCount to 0");
  assertEqual(restarted.tier, 1, "RESTART returns tier to 1");
  assertGreaterThan(
    restarted.board.nodes.length,
    0,
    "RESTART generates a board",
  );
  assertEqual(
    channelsPresent(boardFromSnapshot(restarted)).length,
    TIERS[0].channels,
    "the board RESTART generates carries tier 1's channel count",
  );
  const beams = Object.entries(restarted.beams);
  assertGreaterThan(
    beams.length,
    0,
    "the generated board carries a beam entry",
  );
  for (const [channel, beam] of beams) {
    if (beam === undefined) continue;
    assertDeepEqual(beam.cells, [], `the ${channel} beam arrives empty`);
  }
});
