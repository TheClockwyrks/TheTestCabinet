// Refract — cascade/restart: RESTART drops to tier 1.
//
// specs/modes/cascade.md "The solved screen": RESTART returns `solvedCount`
// to 0 and `tier` to 1, generates a board, and moves to `playing`. Two boards
// are really solved first — the spec-derived solver's beams drawn through the
// pointer operations — so the progression being dropped is real (solvedCount
// 2), and
// RESTART is chosen the way a player chooses it: `down` from NEXT BOARD to
// RESTART on the solved menu, then `confirm`, through the registered actions.
// (The spec's no-reseed clause is the generator's internals and is not
// asserted; what is observable is the progression dropping and a fresh board
// arriving.)

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  solveGenerated,
  startCascade,
  tapAction,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns solvedCount to 0 and tier to 1, and moves to playing on a fresh board", async () => {
  await resetTo(h, 1);
  await startCascade(h);
  await solveGenerated(h, 2);
  assertEqual(
    h.snapshot().solvedCount,
    2,
    "two boards are recorded solved before RESTART (precondition)",
  );

  // down moves the solved menu's highlight from NEXT BOARD to RESTART.
  await tapAction(h, "down");
  assertEqual(
    h.snapshot().menuIndex,
    1,
    "down highlights RESTART, the second of SOLVED_ITEMS (precondition)",
  );
  await tapAction(h, "confirm");
  captureStill(h, "restarted");

  const snapshot = h.snapshot();
  assertEqual(snapshot.solvedCount, 0, "RESTART returns solvedCount to 0");
  assertEqual(snapshot.tier, 1, "RESTART returns tier to 1");
  assertEqual(snapshot.screen, "playing", "RESTART moves to playing");
  assertGreaterThan(
    snapshot.board.nodes.length,
    0,
    "RESTART generates a board (specs/modes/cascade.md)",
  );
  for (const [channel, beam] of Object.entries(snapshot.beams)) {
    assertEqual(
      beam.cells.length,
      0,
      `the ${channel} beam is empty after RESTART`,
    );
  }
});
