// extraction/recoil-hold — a recoiled group stands still for RECOIL_HOLD (0.4 s)
// and then rides again.
//
// THE RULE, FROM THE SPEC. specs/extraction.md — "Removals and recoil": "The group
// then holds for `RECOIL_HOLD` (`0.4` s) of simulation time and advances again
// once that hold expires." specs/channel.md — "Advance" — says the same from the
// train's side: "A segment whose recoil hold has not expired | it does not
// advance". `RECOIL_HOLD` is 0.4 s in specs/extraction.md's Figures table.
//
// THE DRIVE is recoil-distance's: one segment of three halide at the head and four
// cobalt behind them, the inlet held (specs/instrumentation.md — `setEmission`)
// so nothing arrives to disturb the group, and a halide released straight up the
// field, which extracts the run at the head and recoils the four cobalt. What that
// check reads as a distance, this one reads as a stillness.
//
// WHY 23 TICKS. specs/instrumentation.md fixes the tick at `TICK_DT` (1 / 60 s),
// so 0.4 s of hold is exactly 24 ticks. The check steps 23 — one short — so the
// reading sits strictly inside the hold whichever way a build orders the tick's
// first step ("Every running timer falls by the tick's elapsed time") against its
// second ("Every segment advances"): both orderings leave the group still on tick
// 23, and they differ only on tick 24. Both bounds come from `ticksFor` over
// `RECOIL_HOLD` rather than being spelled.
//
// THE TOLERANCE on "unchanged" is RECOIL_TOL, the +/- 0.2 the review item states
// for itself in place of the standing +/- 0.5 on an arc position. It has to be
// some non-zero span because a held group is still a number a build may carry
// through arithmetic, and it is forty times under what a build that ignored the
// hold would show: the recoiled group is the lead segment, so it would advance at
// level 1's feed of 22 units/s and cover 23 / 60 x 22 = 8.4 units over the same
// span.
//
// AND THEN IT RIDES AGAIN. "advances again once that hold expires" is the second
// half of the same sentence, so the check carries on to 40 ticks — 0.667 s, at
// least 16 ticks past the hold under either tick ordering — and reads that the
// group has moved. The bar is only RECOIL_TOL, because how FAST it then rides is
// channel's advance point rather than this one; what is being excluded here is a
// build that stops a recoiled group for good.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertTrue,
} from "../assert";
import { OPENING_AIM, RECOIL_HOLD, RECOIL_TOL } from "../constants";
import {
  captureReplay,
  coreCount,
  createHarness,
  driveShot,
  fireAt,
  poseHall,
  spacedRun,
  tail,
  ticksFor,
  type Harness,
} from "../harness";

/** The head of the posed segment, at `(420, 40)` on specs/channel.md's first leg. */
const HEAD_S = 380;

/** Three of one charge at the head, four of another behind them, in one segment. */
const POSED = [
  "halide",
  "halide",
  "halide",
  "cobalt",
  "cobalt",
  "cobalt",
  "cobalt",
] as const;

/** The four cores the insertion extracts: the posed three plus the seated one. */
const EXTRACTED = 4;

/** One tick short of the 0.4 s hold: 23 ticks, whichever way the tick is ordered. */
const HELD_TICKS = ticksFor(RECOIL_HOLD) - 1;

/** On to 40 ticks in all — 0.667 s, well past the hold under either ordering. */
const AFTER_HOLD_TICKS = 40 - HELD_TICKS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the recoiled group for 0.4 s and lets it advance after", async () => {
  await poseHall(h, {
    cores: spacedRun(HEAD_S, POSED),
    loaded: "halide",
  });

  fireAt(h, OPENING_AIM);
  const held = await captureReplay(h, "hold", async () => {
    const shot = await driveShot(h);
    assertTrue(shot.landed, "the fired core to reach the channel");
    // The recoil this check is about happened: the run of four went and the four
    // cobalt behind it are what is left to hold.
    assertEqual(
      coreCount(shot.snapshot),
      POSED.length + 1 - EXTRACTED,
      "cores left after the extraction",
    );
    const recoiled = tail(shot.snapshot).s;

    const inside = tail(await h.step(HELD_TICKS)).s;
    const after = tail(await h.step(AFTER_HOLD_TICKS)).s;
    return { recoiled, inside, after };
  });

  // Inside the hold the group has not moved.
  assertNear(held.inside, held.recoiled, RECOIL_TOL);
  // Past the hold it is riding again.
  assertGreaterThan(held.after - held.recoiled, RECOIL_TOL);
});
