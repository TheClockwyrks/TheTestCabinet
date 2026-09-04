// pierce/expires-after-360 — pierce runs a 360-tick timer, and at 0 every
// ball returns to ordinary contacts.
//
// specs/pods.md fixes both halves. The duration: pierce's row of the kinds
// table reads "360 ticks", and "Timed effects" has each timer start "at its
// duration" on the catch and count "down by one on every tick the simulation
// advances". The expiry: "When a timer reaches 0 the effect ends... an ended
// pierce returns every ball to ordinary contacts." The first check catches a
// real pierce pod and reads the armed timer — 360, allowing 359 for a build
// that orders the catch before the tick's own decrement, the one tick of
// slack the tick order leaves honest. The second poses the timer at 3 ticks,
// lets it die, and drives a contact well after: an ordinary hit on a
// 2-hit-point target that leaves it live at 1, where a still-piercing ball
// would have removed it.
//
// THE WORLD IS AS SMALL AS EACH CHECK NEEDS, per isolate(): one falling pod
// under the deflector's boot span for the catch; one frozen target and one
// ball for the expiry. isolate() holds podSpawn off, which gates only the
// DRAWN pods of destructions — a posed pod falls, and is caught, unchanged.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual, assertLength } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  outboundBall,
  PIERCE_DURATION,
  poseIsolated,
  poseRingTwoTarget,
  ringTwoTarget,
  spawnPiercePod,
} from "./stage";

/** The ring 2 slot the expiry check's target is posed in. */
const SLOT = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("a caught pierce pod arms the 360-tick timer", async () => {
  await poseIsolated(h);
  // Falling at 2 units per tick from radius 199, on the deflector's boot
  // angle: the crossing of catch radius 196 resolves on tick 2 (197 to 195).
  await spawnPiercePod(h, 199, 90);

  const after = await captureReplay(h, "catch", async () => {
    const caught = await h.tick(2);
    await h.tick(4);
    return caught;
  });

  assertLength(after.pods, 0, "the pod was caught");
  assertBetween(
    after.effects.pierceTicks,
    PIERCE_DURATION - 1,
    PIERCE_DURATION,
    "the timer the catch armed, at its full 360-tick duration",
  );
});

it("after the timer runs out, a contact is ordinary again", async () => {
  await poseIsolated(h);
  await armPierce(h, 3); // in force for three ticks, spent long before the contact
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2, freeze: true });
  // From radius 325 at 4 units per tick, the crossing of contact radius 352
  // resolves on tick 7 (349 to 353) — four ticks after the timer died.
  await outboundBall(h, arcDeg, 325);

  const after = await captureReplay(h, "expired", async () => {
    const contacted = await h.tick(8);
    await h.tick(4);
    return contacted;
  });

  assertEqual(
    after.effects.pierceTicks,
    0,
    "the timer ran out before the contact",
  );
  assertEqual(
    ringTwoTarget(after, SLOT)?.hp,
    1,
    "an ordinary hit: one hit point removed, the target still live",
  );
});
