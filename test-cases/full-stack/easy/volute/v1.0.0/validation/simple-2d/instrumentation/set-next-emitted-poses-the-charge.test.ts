// instrumentation/set-next-emitted-poses-the-charge — the charge posed with
// `setNextEmitted` is the charge of the next core the inlet places.
//
// THE SPEC LINES. `specs/instrumentation.md`, `setNextEmitted`: "Poses the charge
// of the next core the inlet emits. ... The next emission places a core carrying
// `charge` in place of the draw `specs/channel.md` states, whatever the channel
// holds", and "The snapshot reports the pose as `nextEmitted`". `specs/channel.md`,
// "Emission": an emitted core's charge is otherwise "drawn at random, uniformly
// over the set of distinct charges on the channel at the moment of emission".
//
// WHY THE CHANNEL IS HALIDE ALONE. On a channel carrying one charge the draw has
// one outcome, so a build that ignored the pose and drew could only have placed
// halide. Posing garnet, a charge standing nowhere on the channel, is therefore
// what makes the reading decisive: the core at the inlet is garnet because the
// pose was honoured, and for no other reason. Level 5, so garnet is a charge the
// level itself has in play (`specs/progression.md`) and the pose stays inside the
// bounds the specification sets.
//
// WHY ONE TICK. `specs/channel.md`: the inlet emits "on a tick where the tail
// core's arc position is at least `SPACING`", and the posed tail stands at 300,
// so the emission is step 7 of the very next tick. The core it places stands at
// `s = 0`, which is the tail of a train reported head first.
//
// WHAT IS NOT ASSERTED. That the pose is gone once the emission has taken it is
// `instrumentation/set-next-emitted-consumed-by-the-emission`; that `null`
// clears a standing pose is `instrumentation/set-next-emitted-null-clears-the-pose`.
// TOLERANCES: none. A charge id is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
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

/** The level: garnet is in play, so the posed charge is one the level draws. */
const LEVEL = 5;

/** The single-charge train the channel is posed with, head first from 356. */
const STANDING: ChargeId = "halide";
const STANDING_HEAD_S = 356;
const STANDING_COUNT = 3;

/** The charge posed for the emission: standing nowhere on the channel. */
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

it("places the posed charge at the inlet on the next emission", async () => {
  await poseHall(h, {
    level: LEVEL,
    // The inlet is the faculty this point is about, so it is the one gate left
    // open (`specs/instrumentation.md`, `setEmission`).
    emission: true,
    quotaRemaining: QUOTA,
    cores: spacedBlock(STANDING_HEAD_S, STANDING_COUNT, STANDING),
  });
  await h.debug.setNextEmitted(POSED);

  // The pose reads back before any tick runs.
  const posed = await h.snapshot();
  assertEqual(posed.nextEmitted, POSED, "the charge setNextEmitted posed");

  const after = await h.step(1);
  await captureStill(h, "posed-emitted");

  assertEqual(
    coreCount(after),
    STANDING_COUNT + 1,
    "the cores on the channel once the inlet has placed one",
  );
  assertEqual(
    after.quotaRemaining,
    QUOTA - 1,
    "the quota once the inlet has placed one core",
  );
  assertEqual(
    tail(after).charge,
    POSED,
    `the charge of the core placed at the inlet, posed ${POSED} onto a ${STANDING}-only channel`,
  );
});
