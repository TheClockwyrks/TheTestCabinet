// Refract — cascade/restart: RESTART drops to tier 1.
//
// specs/modes/cascade.md "The solved screen": RESTART returns solvedCount to
// 0 and tier to 1, generates a board, and moves to playing. The run is posed
// at one solve through `setSolvedCount` and `setTier`
// (specs/instrumentation.md) and a posed board is solved for the second, so
// progress stands and the solved screen is reached the way a player's solve
// reaches it. RESTART is chosen the way a player chooses it — `down` from
// NEXT BOARD (menuIndex 0 on arriving at solved) to RESTART, then `confirm` —
// and the sequence reads freshly begun: count 0, tier 1, a board present
// carrying tier 1's channel count, every beam empty.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  poseCascadeRun,
  resetTo,
  solvePosedBoard,
  tapAction,
  type Harness,
} from "../harness";
import { TIERS, channelsPresent } from "../notation";
import { assertEveryBeamEmpty } from "./helpers";

const SOLVES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns solvedCount to 0 and tier to 1, and opens a fresh tier-1 board", async () => {
  await resetTo(h);
  poseCascadeRun(h, SOLVES - 1);
  const solvedScreen = await solvePosedBoard(h);
  assertEqual(
    solvedScreen.solved,
    true,
    "precondition: the posed board solves",
  );
  assertEqual(solvedScreen.screen, "solved", "the second solve's screen is up");
  assertEqual(solvedScreen.solvedCount, SOLVES, "two solves stand to discard");
  assertEqual(solvedScreen.menuIndex, 0, "the menu rests on NEXT BOARD");
  await h.advance(1);

  // Down to RESTART, then take it.
  await tapAction(h, "down");
  assertEqual(h.snapshot().menuIndex, 1, "down highlights RESTART");
  await tapAction(h, "confirm");
  await h.advance(1);
  // The sequence restarted at tier 1.
  captureStill(h, "restarted");

  const restarted = h.snapshot();
  assertEqual(restarted.screen, "playing", "RESTART moves to playing");
  assertEqual(restarted.solvedCount, 0, "RESTART returns solvedCount to 0");
  assertEqual(restarted.tier, 1, "RESTART returns tier to 1");
  assertGreaterThanOrEqual(
    restarted.board.cols,
    1,
    "a board is generated: cols",
  );
  assertGreaterThanOrEqual(
    restarted.board.rows,
    1,
    "a board is generated: rows",
  );
  assertGreaterThan(
    restarted.board.nodes.length,
    0,
    "a board is generated: nodes",
  );
  assertEqual(
    channelsPresent(boardFromSnapshot(restarted)).length,
    TIERS[0].channels,
    "the board RESTART generates carries tier 1's channel count",
  );
  assertEveryBeamEmpty(
    restarted,
    "the restarted board opens with every beam empty",
  );
});
