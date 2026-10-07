// Refract — cascade/restart: RESTART drops to tier 1.
//
// specs/modes/cascade.md "The solved screen": RESTART returns `solvedCount`
// to 0 and `tier` to 1, generates a board, and moves to `playing`. The run is
// posed at one solve through `setSolvedCount` and `setTier`
// (specs/instrumentation.md) and a posed board is solved for the second, so
// the progression being dropped is real (solvedCount 2) and the solved screen
// is reached the way a player's solve reaches it. RESTART is chosen the way a
// player chooses it: `down` from NEXT BOARD to RESTART on the solved menu,
// then `confirm`, through the registered actions. The board RESTART generates
// is read for tier 1's channel count, which is what "generates a board" at
// tier 1 means.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  oracleBoard,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  tapAction,
  type Harness,
} from "../harness";
import { TIERS, channelsPresent } from "../notation";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns solvedCount to 0 and tier to 1, and moves to playing on a fresh tier-1 board", async () => {
  await resetTo(h);
  poseCascadeRun(h, 1);
  const arrived = await solvePosedBoard(h);
  assertEqual(arrived.solved, true, "precondition: the posed board solves");
  assertEqual(
    arrived.screen,
    "solved",
    "precondition: on the solved screen (see cascade-solved-reached)",
  );
  assertEqual(
    arrived.solvedCount,
    2,
    "two boards are recorded solved before RESTART (precondition)",
  );
  await h.advance(1);

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
  assertEqual(
    channelsPresent(oracleBoard(snapshot)).length,
    TIERS[0].channels,
    "the board RESTART generates carries tier 1's channel count",
  );
  const beams = Object.entries(snapshot.beams);
  assertGreaterThan(
    beams.length,
    0,
    "the generated board carries a beam entry",
  );
  for (const [channel, beam] of beams) {
    assertEqual(
      beam.cells.length,
      0,
      `the ${channel} beam is empty after RESTART`,
    );
  }
});
