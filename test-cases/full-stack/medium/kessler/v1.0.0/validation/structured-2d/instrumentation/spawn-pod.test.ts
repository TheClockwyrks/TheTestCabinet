// instrumentation/spawn-pod — the posed pod falls like a drawn one, and the
// seeded stream has not moved.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `spawnPod` as
// "adds one pod of `kind` ... at `(x, y)`. It falls radially inward at the fall
// speed specs/pods.md fixes, from the call onward", and closes with the
// generator clause: "the generator is not consumed, so the seeded sequence
// stays where it stands." specs/pods.md fixes the fall: "the pod falls radially
// inward at `120` units per second, its center angle constant".
//
// TWO READS DECIDE IT. The flight read poses two pods and runs a second of
// ticks: each reads back its kind and position at the call, and afterwards
// stands `120` units further in on an unchanged angle. The generator read is
// against the stream specs/pods.md fixes exactly (mulberry32 under the session
// seed): under seed 8 the FIRST draw sheds a `shield` pod, so after the two
// `spawnPod` calls a destruction's draw must still be that first draw. A build
// whose `spawnPod` consumed the stream reads a later value there (`u1 >= 0.25`
// for the next four) and sheds nothing.
//
// The float tolerance on the fall is integration slack over 60 fixed ticks of
// the exact `120 * 1/60` advance — generous at a twentieth of a unit.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength, fail } from "../assert";
import { POD_FALL_SPEED } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  xyToPolar,
  type Harness,
} from "../harness";
import { podSequence } from "./rng";
import { shedDestruction } from "./shed";

/** The session seed: specs/pods.md's stream sheds on seed 8's FIRST draw. */
const SEED = 8;

/** The two posed pods, well clear of every crossing radius. */
const PODS = [
  { kind: "pierce", r: 400, thetaDeg: 200 },
  { kind: "narrow", r: 380, thetaDeg: 340 },
] as const;

/** A second of ticks: 120 units of fall. */
const FALL_TICKS = 60;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds the posed pods, falls them at 120, and leaves the stream", async () => {
  isolate(h, SEED);
  for (const pod of PODS) spawnPodPolar(h, pod.kind, pod.r, pod.thetaDeg);

  const posed = h.snapshot();
  assertLength(posed.pods, 2, "the pods after the two calls");
  posed.pods.forEach((pod, i) => {
    assertEqual(pod.kind, PODS[i].kind, `pod ${i}'s kind`);
    const at = xyToPolar(pod.x, pod.y);
    assertCloseTo(at.r, PODS[i].r, 3, `pod ${i}'s posed radius`);
    assertCloseTo(at.thetaDeg, PODS[i].thetaDeg, 3, `pod ${i}'s posed angle`);
  });

  const fallen = await captureReplay(h, "falling", () => h.tick(FALL_TICKS));
  assertLength(fallen.pods, 2, "the pods after a second of fall");
  fallen.pods.forEach((pod, i) => {
    const at = xyToPolar(pod.x, pod.y);
    assertCloseTo(
      at.r,
      PODS[i].r - POD_FALL_SPEED,
      1,
      `pod ${i}'s radius after a second`,
    );
    assertCloseTo(
      at.thetaDeg,
      PODS[i].thetaDeg,
      1,
      `pod ${i}'s angle in the fall`,
    );
  });

  // The stream: the next draw is still the seed's FIRST draw.
  const expected = podSequence(SEED, 1)[0];
  if (expected === null) {
    return fail("a seed whose first draw sheds a pod", "seed 8 shed nothing");
  }
  h.debug.clearPods();
  h.debug.setPodSpawn(true);
  const destroyed = await shedDestruction(h, 0);
  assertLength(destroyed.pods, 1, "the pod the first real draw shed");
  assertEqual(
    destroyed.pods[0].kind,
    expected,
    "the shed kind against the seed's first draw",
  );
});
