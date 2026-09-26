// cascade/solved-next-board — NEXT BOARD hands the player a fresh board at the
// tier the run has reached.
//
// specs/modes/cascade.md's solved-screen table: NEXT BOARD "Generates a board
// at the current `state.tier` and moves to `playing` with every beam empty."
// The clause that makes it NEXT BOARD rather than RESTART is what it does NOT
// touch — the run's progress — so the count and the tier are read after the
// choice as well as before it, and cascade/restart owns the opposite reading.
//
// THE WORLD IS POSED. The run is posed at four solves through `setSolvedCount`
// and `setTier` (specs/instrumentation.md), and the fifth board is posed
// through `loadBoard` and solved — "a board posed this way is a board like any
// other" — so the run reaches the solved screen the way a player's does, with
// no NEXT BOARD press during the arrangement. That posed solves raise the
// count is cascade/cascade-solved-copy's point, asserted here as a named
// precondition.
//
// FIVE SOLVES, NOT ONE. At tier 1 the claim "generates a board at the current
// state.tier" is unfalsifiable, because 1 is also the resting value a build
// that ignored the tier entirely would report. TIER_ADVANCE (5) solves put the
// run on tier 2, so the carried tier is a figure the run reached rather than
// the one it started on; tierForSolvedCount is the spec's own formula from
// notation.ts, and cascade/tier-ladder owns the climb itself. The board NEXT
// BOARD hands over is read for tier 2's channel count, which is what "at the
// current state.tier" means for it; its grid and the rest of its row belong to
// the tier suites.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  TIER_ADVANCE,
  TIERS,
  channelsPresent,
  tierForSolvedCount,
} from "../notation";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  fireAction,
  poseCascadeRun,
  solvePosedBoard,
  type Harness,
} from "../harness";

/** The tier the run has reached after TIER_ADVANCE solves: 2, not the resting 1. */
const REACHED_TIER = tierForSolvedCount(TIER_ADVANCE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("NEXT BOARD opens an empty board at the reached tier and carries the count and the tier forward", async () => {
  await poseCascadeRun(h, TIER_ADVANCE - 1);
  const arrived = await solvePosedBoard(h);
  assertEqual(
    arrived.screen,
    "solved",
    "precondition: the posed solve reaches the solved screen (see cascade-solved-reached)",
  );
  assertEqual(
    arrived.solvedCount,
    TIER_ADVANCE,
    `precondition: the posed solve is counted, ${TIER_ADVANCE} in all (see cascade-solved-copy)`,
  );
  assertEqual(
    arrived.tier,
    REACHED_TIER,
    `precondition: the run has climbed to tier ${REACHED_TIER} (see tier-ladder)`,
  );
  assertEqual(
    arrived.menuIndex,
    0,
    "precondition: NEXT BOARD is highlighted on arriving at solved",
  );

  await fireAction(h, "confirm");
  await captureStill(h, "board");

  const next = await h.snapshot();
  assertEqual(next.screen, "playing", "NEXT BOARD moves to playing");
  assertGreaterThan(next.board.nodes.length, 0, "NEXT BOARD generates a board");
  assertEqual(
    channelsPresent(boardFromSnapshot(next)).length,
    TIERS[REACHED_TIER - 1].channels,
    `the board carries tier ${REACHED_TIER}'s channel count: generated at the current state.tier`,
  );
  // A board present carries at least one channel, so an entry-less `beams` is
  // itself a failure rather than a vacuous pass — the reading
  // structured-2d's assertEveryBeamEmpty already takes, so the three engines
  // decide this point alike.
  const beamEntries = Object.entries(next.beams);
  assertGreaterThan(
    beamEntries.length,
    0,
    "the board NEXT BOARD handed over carries at least one beam entry",
  );
  for (const [channel, beam] of beamEntries) {
    if (beam === undefined) continue;
    assertDeepEqual(beam.cells, [], `the ${channel} beam arrives empty`);
  }
  assertEqual(
    next.solvedCount,
    TIER_ADVANCE,
    "NEXT BOARD carries the run's progress forward",
  );
  assertEqual(
    next.tier,
    REACHED_TIER,
    "and the tier it has reached — this is what separates NEXT BOARD from RESTART",
  );
});
