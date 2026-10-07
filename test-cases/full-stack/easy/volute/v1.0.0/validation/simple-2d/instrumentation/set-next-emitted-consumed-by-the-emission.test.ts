// instrumentation/set-next-emitted-consumed-by-the-emission — the emission that
// places the posed charge consumes the pose, and a pose made after it lands on
// the emission after.
//
// THE SPEC LINES. `specs/instrumentation.md`, `setNextEmitted`: "that emission
// consumes the pose, so every emission after it is drawn again until the next
// call", and the snapshot reports `nextEmitted` as "`null` while none stands".
//
// THE DRIVE. A halide-only channel on level 5 with the inlet open. Garnet is
// posed and one tick placed at the inlet, after which the pose reads `null`. Then
// cobalt is posed and the hall stepped until the inlet places its second core,
// which is cobalt: the second pose landed on the second emission, which it could
// only do if the first emission had taken the first pose off the way. A build
// that left the pose standing reads garnet from `nextEmitted` after the first
// tick and fails there.
//
// WHY THE SECOND EMISSION IS WAITED FOR RATHER THAN COUNTED TO. `specs/channel.md`
// has the inlet emit "on a tick where the tail core's arc position is at least
// `SPACING`", and the first placed core is now the tail, standing at `s = 0` and
// closing on the train ahead at the catch-up rate. The tick it reaches 28 on is
// `channel/emission-cadence`'s figure, so the drive watches the quota fall by
// one instead of asserting when: "Each emission decrements the level's quota by
// one" is the one reading that identifies an emission exactly.
//
// TOLERANCES: none. A charge id is exact, and the wait is bounded at 60 ticks,
// several times the ~10 the catch-up rate needs to carry the tail to 28.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull, assertTrue } from "../assert";
import type { ChargeId } from "../constants";
import {
  captureStill,
  createHarness,
  poseHall,
  spacedBlock,
  tail,
  type Harness,
} from "../harness";

/** The level: both posed charges are in play. */
const LEVEL = 5;

/** The single-charge train the channel is posed with, head first from 356. */
const STANDING: ChargeId = "halide";
const STANDING_HEAD_S = 356;
const STANDING_COUNT = 3;

/** The charge posed for the first emission, and the one for the second. */
const FIRST: ChargeId = "garnet";
const SECOND: ChargeId = "cobalt";

/** Cores left in the quota, so the inlet has both cores to place. */
const QUOTA = 5;

/** Ticks allowed for the second emission: well over the catch-up to `SPACING`. */
const MAX_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("consumes the pose on the emission that places it", async () => {
  await poseHall(h, {
    level: LEVEL,
    // The inlet is the faculty this point is about, so it is the one gate left
    // open (`specs/instrumentation.md`, `setEmission`).
    emission: true,
    quotaRemaining: QUOTA,
    cores: spacedBlock(STANDING_HEAD_S, STANDING_COUNT, STANDING),
  });
  await h.debug.setNextEmitted(FIRST);

  const first = await h.step(1);
  assertEqual(
    first.quotaRemaining,
    QUOTA - 1,
    "the quota once the inlet has placed the first core",
  );
  assertEqual(
    tail(first).charge,
    FIRST,
    "the charge of the first core the inlet placed",
  );
  assertNull(first.nextEmitted, "the pose once the emission has taken it");

  // The pose after the first one lands on the emission after the first one.
  await h.debug.setNextEmitted(SECOND);
  const swept = await h.stepUntil(
    (snapshot) => snapshot.quotaRemaining <= QUOTA - 2,
    { maxTicks: MAX_TICKS, poll: 1 },
  );
  await captureStill(h, "consumed");

  assertTrue(
    swept.hit,
    `a second core placed at the inlet within ${MAX_TICKS} ticks`,
  );
  assertEqual(
    tail(swept.snapshot).charge,
    SECOND,
    "the charge of the second core the inlet placed",
  );
  assertNull(
    swept.snapshot.nextEmitted,
    "the pose once the second emission has taken it",
  );
});
