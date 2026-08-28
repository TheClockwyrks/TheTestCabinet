// cascade/restart — RESTART drops the run to tier 1.
//
// specs/modes/cascade.md's solved-screen table: RESTART "returns
// state.solvedCount to 0 and state.tier to 1, generates a board, and moves to
// playing" — read after two real solves, so the 0 and the 1 are a genuine drop
// rather than the values the run already held. The item is chosen the way a
// player chooses it: `menuIndex` is 0 on arriving at solved, one `down` moves
// it to RESTART, and `confirm` takes it. (The spec's no-reseed clause — RESTART
// "carries on from the state it holds" — fixes nothing a build-independent
// check can observe, and is deliberately not asserted.)

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  fireAction,
  solveGenerated,
  type Harness,
} from "../harness";

const SEED = 7;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("RESTART after two solves returns to solvedCount 0, tier 1, a fresh board", async () => {
  const sweep = await solveGenerated(h, 2, SEED);
  for (const [index, after] of sweep.afterSolve.entries()) {
    assertEqual(
      after.solved,
      true,
      `precondition: board ${index + 1} solved (see boards-are-solvable)`,
    );
  }
  const arrived = sweep.afterSolve[1];
  assertEqual(arrived.screen, "solved", "precondition: on the solved screen");
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
  for (const [channel, beam] of Object.entries(restarted.beams)) {
    if (beam === undefined) continue;
    assertDeepEqual(beam.cells, [], `the ${channel} beam arrives empty`);
  }
});
