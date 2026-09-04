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
// THE DRIVE. The chain is first taken to step 2 the only way the specification
// allows — a merge extraction, the "previous step plus 1" row — by posing a lead
// segment of halide, cobalt, cobalt with a detached cobalt, halide behind it and
// letting the catch-up close the gap. Then nothing is done but step.
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
//     about. The two halide the merge extraction leaves ride on and cannot extract
//     — a run of two is under specs/extraction.md's minimum of three — so the
//     channel stays occupied and quiet at the same time.
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
  assertTrue,
} from "../assert";
import { CHAIN_RESET, MIN_RUN, SPACING, TICK_DT, TICK_TOL } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  poseHall,
  spacedRun,
  ticksFor,
  type Harness,
} from "../harness";

/** The lead segment of the merge pose, at `(540, 40)` on specs/channel.md's first leg. */
const LEAD_HEAD_S = 500;

/** A halide ahead of two cobalt, so the run spanning the join stops there. */
const LEAD = ["halide", "cobalt", "cobalt"] as const;

/** A cobalt at the head with a halide behind it, so the run stops there too. */
const TRAIL = ["cobalt", "halide"] as const;

/** How far behind the merge position the trailing segment starts. */
const GAP = 60;

/** The trailing segment's head: one spacing plus the gap behind the lead's tail. */
const TRAIL_HEAD_S = LEAD_HEAD_S - (LEAD.length - 1) * SPACING - SPACING - GAP;

/** How long the check waits for the catch-up, against about 23 ticks of it. */
const APPROACH_TICKS = 180; // 3 s

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
  // The chain is raised to step 2 the only way the specification allows.
  await poseHall(h, {
    cores: [...spacedRun(LEAD_HEAD_S, LEAD), ...spacedRun(TRAIL_HEAD_S, TRAIL)],
  });
  const merge = await h.stepUntil(
    (snapshot) => coreCount(snapshot) <= LEAD.length + TRAIL.length - MIN_RUN,
    { maxTicks: APPROACH_TICKS, poll: 1 },
  );
  assertTrue(merge.hit, "a merge extraction to raise the chain");
  assertEqual(
    merge.snapshot.chainStep,
    2,
    "the chain step a merge extraction leaves",
  );

  // Nothing left to emit, so the quiet is the inlet's as well as the train's
  // (specs/channel.md — "Emission").
  await h.debug.setQuotaRemaining(0);

  const quiet = await captureReplay(h, "reset", () => h.step(LAPSE_TICKS));

  // The hall was quiet: nothing extracted across the window, so what lapsed is the
  // clock rather than a run being drawn out.
  assertEqual(quiet.score, merge.snapshot.score, "the score across the quiet");
  // And it was still a level being played, with cores on the channel — an emptied
  // channel under an exhausted quota clears the level instead.
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
