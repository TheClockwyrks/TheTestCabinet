// Refract — instrumentation/generate-board: `generateBoard` poses a board the
// generator emits at the tier named, and leaves the run as it was.
//
// specs/instrumentation.md, `generateBoard(tier)`: "Asks the generator in
// specs/modes/cascade.md for one board at `tier` ... and poses it exactly as
// `loadBoard` poses a board: the game moves to `playing` with that board in
// play, every beam empty, and no trace live ... `mode`, `solvedCount`, `tier`,
// and every other field are left as they are". The run is posed at
// solvedCount 2 and tier 1 on the title, a tier-4 board is asked for, and the
// screen, the board's channels, the beams, the trace, and the progression are
// read back. The tier named differs from the run's own, so a build generating
// at `state.tier` fails on the channel count, and a build writing the argument
// into `state.tier` fails on the tier.
//
// A screen-changing pose lands by the end of the next advanced frame (the
// shared convention), so the read is taken after that frame. Whether the board
// meets the rest of tier 4's row — its grid, its crystals, its floor — belongs
// to the cascade suites, which read it at every tier.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertNull,
} from "../assert";
import { CHANNELS, TIERS, channelsPresent } from "../notation";
import {
  boardFromSnapshot,
  captureStill,
  createHarness,
  poseCascadeRun,
  resetTo,
  type Harness,
} from "../harness";
import { assertEveryBeamEmpty } from "../cascade/helpers";

/** A run in progress, posed short of the tier the board is asked for at. */
const RUN_COUNT = 2;
/** A tier whose channel count (3) differs from the posed run's tier 1 (1). */
const ASKED_TIER = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("poses a tier-4 board on playing with empty beams, the run untouched", async () => {
  await resetTo(h);
  poseCascadeRun(h, RUN_COUNT);
  h.debug.setScreen("title");
  await h.advance(1);
  const before = h.snapshot();
  assertEqual(before.tier, 1, "precondition: the run stands at tier 1");

  h.debug.generateBoard(ASKED_TIER);
  await h.advance(1);
  captureStill(h, "generated");

  const posed = h.snapshot();
  assertEqual(posed.screen, "playing", "generateBoard moves to playing");
  const board = boardFromSnapshot(posed);
  assertGreaterThan(board.nodes.length, 0, "a board is in play");
  assertDeepEqual(
    channelsPresent(board),
    CHANNELS.slice(0, TIERS[ASKED_TIER - 1].channels),
    `the board carries tier ${ASKED_TIER}'s channel count, the first n of ` +
      "CHANNELS (specs/modes/cascade.md, The tier ladder)",
  );
  assertEveryBeamEmpty(posed, "the generated board");
  assertNull(posed.tracing, "no trace is live");

  assertEqual(posed.mode, "cascade", "mode as it was");
  assertEqual(posed.solvedCount, RUN_COUNT, "solvedCount as it was");
  assertEqual(posed.tier, before.tier, "tier as it was, not the tier named");
});
