// extraction/chain-reset — CHAIN_RESET (2.0 s) of quiet takes the chain step back
// to 1 on its own.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "The chain step":
// "`CHAIN_RESET` (2.0 s) elapses with no extraction | 1", and "The elapsed time
// since the most recent extraction falls with the ticks that advance play, and
// every extraction restarts it." specs/instrumentation.md reports both halves —
// `chainStep` and `chainTimer`, "seconds left before the step returns to 1".
// `CHAIN_RESET` is 2.0 s in specs/extraction.md's Figures table.
//
// THIS IS THE THIRD DIRECTION. chain-increment grades the step a merge adds and
// chain-insertion-resets the step an insertion takes the chain back to; a build can
// get both of those right and never let the chain lapse on its own, so the quiet
// hall is its own point.
//
// THE CHAIN IS POSED, NOT EARNED. specs/instrumentation.md (`setChainStep`) "sets
// the chain step an extraction scores at to `k` ... and restarts the window that
// returns the step to `1`, so the posed step holds for `CHAIN_RESET` (`2.0` s) of
// play from the call." So the window this point measures starts at the pose, and
// nothing is driven to raise the step: what RAISES it is
// `extraction/chain-increment`'s requirement, and a build broken there must fail
// that point alone rather than this one too.
//
// WHY 122 TICKS. specs/instrumentation.md fixes the tick at `TICK_DT` (1 / 60 s),
// so 2.0 s is exactly 120 ticks and the lapse falls on the 120th. The check steps
// two ticks past that — the case's standing `TICK_TOL` of +/- 2 ticks on a
// duration — so a conformant build has lapsed however it rounds the last tick.
// Both figures come from `ticksFor` over `CHAIN_RESET` and from `TICK_TOL` rather
// than being spelled.
//
// WHAT THE QUIET HALL HAS TO KEEP. Two things would make the reading mean something
// else, so both are asserted rather than assumed:
//
//   - Cores still standing. specs/progression.md — "Clearing a level": "A level is
//     cleared the moment its quota is exhausted and no cores remain on the
//     channel", and specs/channel.md's tick order runs that check every tick. A
//     hall that emptied would leave `playing` and stop the clock this point is
//     about. Two cores of one charge stand on the straight top run and cannot
//     extract — a run of two is under specs/extraction.md's minimum of three — so
//     the channel stays occupied and quiet at the same time. The inlet is held and
//     the quota is a level start's, so nothing arrives and nothing clears.
//   - No extraction in the window. "elapses with no extraction" is the whole
//     condition, so the check reads that the score never moved across the span.
//
// THE TOLERANCE. The step is a whole number, read exactly. The timer is read as a
// bound rather than an equality: a build that clamps the countdown at 0 and one
// that lets the last partial tick carry it just below 0 are both honest readings of
// "seconds left", and one tick's worth of slack admits both while still ruling out
// a timer that restarted itself.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { CHAIN_RESET, TICK_DT, TICK_TOL } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  spacedBlock,
  ticksFor,
  type Harness,
} from "../harness";

/** The head of the two cores left standing, on specs/channel.md's first leg. */
const HEAD_S = 500;

/** Two of one charge: under the minimum run, so nothing can extract. */
const STANDING_CORES = 2;

/** The step the chain is posed at, above the 1 it must lapse back to. */
const POSED_STEP = 2;

/** 2.0 s of quiet plus the standing two-tick slack: 122 ticks. */
const LAPSE_TICKS = ticksFor(CHAIN_RESET) + TICK_TOL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns the chain to step 1 after 2.0 s with no extraction", async () => {
  await poseHall(h, {
    chainStep: POSED_STEP,
    cores: spacedBlock(HEAD_S, STANDING_CORES, "halide"),
  });

  const posed = h.snapshot();
  assertEqual(
    posed.chainStep,
    POSED_STEP,
    "the chain step the hall was posed at",
  );
  assertGreaterThan(
    posed.chainTimer,
    0,
    "the window the pose restarted, which is what has to elapse",
  );

  const quiet = await captureReplay(h, "reset", () => h.step(LAPSE_TICKS));

  // The hall was quiet: nothing extracted across the window, so what lapsed is the
  // clock rather than a run being drawn out.
  assertEqual(quiet.score, posed.score, "the score across the quiet");
  // And it was still a level being played, with cores on the channel.
  assertGreaterThan(coreCount(quiet), 0, "cores standing through the quiet");
  assertEqual(quiet.screen, "playing");

  // The rule itself.
  assertEqual(quiet.chainStep, 1);
  assertLessThanOrEqual(
    quiet.chainTimer,
    TICK_DT,
    "seconds left on a lapsed chain",
  );
});
