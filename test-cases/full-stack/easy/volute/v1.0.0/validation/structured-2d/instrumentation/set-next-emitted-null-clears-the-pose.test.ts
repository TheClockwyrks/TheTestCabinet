// instrumentation/set-next-emitted-null-clears-the-pose — `setNextEmitted(null)`
// clears a standing pose, so the inlet draws again.
//
// THE SPEC LINES. `specs/instrumentation.md`, `setNextEmitted`: "`charge` is one
// of the five charge ids, or `null` to clear a standing pose", and the snapshot
// reports `nextEmitted` as "`null` while none stands". `specs/channel.md`,
// "Emission": with no pose standing, the charge is "drawn at random, uniformly
// over the set of distinct charges on the channel at the moment of emission".
//
// WHY THE CHANNEL IS HALIDE ALONE. On a channel carrying one charge the draw has
// one outcome, so once the pose is cleared the only charge the inlet can place
// is halide, and a build that let the cleared pose stand would place garnet
// instead. The two rules are told apart on one emission, with nothing sampled.
//
// WHY ONE TICK. `specs/channel.md`: the inlet emits "on a tick where the tail
// core's arc position is at least `SPACING`", and the posed tail stands at 300,
// so the emission is step 7 of the very next tick. The core it places stands at
// `s = 0`, which is the tail of a train reported head first.
//
// TOLERANCES: none. A charge id is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import type { ChargeId } from "../constants";
import {
  captureStill,
  coreCount,
  createHarness,
  poseHall,
  spacedBlock,
  tail,
  type Harness,
} from "../harness";

/** The level: garnet is in play, so the pose that is cleared was a legal one. */
const LEVEL = 5;

/** The single-charge train the channel is posed with, head first from 356. */
const STANDING: ChargeId = "halide";
const STANDING_HEAD_S = 356;
const STANDING_COUNT = 3;

/** The charge posed and then cleared: standing nowhere on the channel. */
const POSED: ChargeId = "garnet";

/** Cores left in the quota, so the inlet has something to place. */
const QUOTA = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the posed charge on null, so the inlet draws from the channel", async () => {
  await poseHall(h, {
    level: LEVEL,
    // The inlet is the faculty this point is about, so it is the one gate left
    // open (`specs/instrumentation.md`, `setEmission`).
    emission: true,
    quotaRemaining: QUOTA,
    cores: spacedBlock(STANDING_HEAD_S, STANDING_COUNT, STANDING),
  });
  h.debug.setNextEmitted(POSED);
  h.debug.setNextEmitted(null);

  // No pose stands, read before any tick runs.
  const cleared = h.snapshot();
  assertNull(cleared.nextEmitted, "the pose setNextEmitted(null) cleared");

  const after = await h.step(1);
  captureStill(h, "cleared");

  assertEqual(
    coreCount(after),
    STANDING_COUNT + 1,
    "the cores on the channel once the inlet has placed one",
  );
  assertEqual(
    tail(after).charge,
    STANDING,
    `the charge of the core placed at the inlet, drawn from a ${STANDING}-only channel with the pose cleared`,
  );
});
