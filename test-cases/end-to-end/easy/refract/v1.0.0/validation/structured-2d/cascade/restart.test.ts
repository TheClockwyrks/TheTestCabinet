// Refract — cascade/restart: RESTART drops to tier 1.
//
// specs/modes/cascade.md "The solved screen": RESTART returns solvedCount to
// 0 and tier to 1, generates a board, and moves to playing. Two real solves
// stand progress up, then RESTART is chosen the way a player chooses it —
// `down` from NEXT BOARD (menuIndex 0 on arriving at solved) to RESTART, then
// `confirm` — and the sequence reads freshly begun: count 0, tier 1, a board
// present, every beam empty. (The spec's no-reseed clause — RESTART carries
// the generator on rather than reseeding — fixes an internal the snapshot
// does not expose per-board, so it is not asserted here.)

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from "../assert";
import {
  captureStill,
  createHarness,
  solveGenerated,
  tapAction,
  type Harness,
} from "../harness";
import { assertEveryBeamEmpty } from "./helpers";

const SEED = 1;
const SOLVES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns solvedCount to 0 and tier to 1, and opens a fresh board", async () => {
  await solveGenerated(h, SOLVES, SEED);
  const solvedScreen = h.snapshot();
  assertEqual(solvedScreen.screen, "solved", "the second solve's screen is up");
  assertEqual(solvedScreen.solvedCount, SOLVES, "two solves stand to discard");
  assertEqual(solvedScreen.menuIndex, 0, "the menu rests on NEXT BOARD");

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
  assertEveryBeamEmpty(
    restarted,
    "the restarted board opens with every beam empty",
  );
});
