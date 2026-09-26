// instrumentation/spawn-pod — the posed pod falls like a drawn one.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md words `spawnPod` as
// "adds one pod of `kind` ... at `(x, y)`. It falls radially inward at the fall
// speed specs/pods.md fixes, from the call onward", and specs/pods.md fixes the
// fall: "the pod falls radially inward at `120` units per second, its center
// angle constant".
//
// THE READ poses two pods and runs a second of ticks: each reads back its kind
// and position at the call, and afterwards stands `120` units further in on an
// unchanged angle. The float tolerance on the fall is integration slack over 60
// fixed ticks of the exact `120 * 1/60` advance — generous at a twentieth of a
// unit.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { POD_FALL_SPEED } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  xyToPolar,
  type Harness,
} from "../harness";

/** The two posed pods, well clear of every crossing radius. */
const PODS = [
  { kind: "pierce", r: 400, deg: 200 },
  { kind: "narrow", r: 380, deg: 340 },
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

it("adds the posed pods and falls them at 120", async () => {
  isolate(h);
  for (const pod of PODS) spawnPodPolar(h, pod.kind, pod.r, pod.deg);

  const posed = h.snapshot();
  assertLength(posed.pods, 2, "the pods after the two calls");
  posed.pods.forEach((pod, i) => {
    assertEqual(pod.kind, PODS[i].kind, `pod ${i}'s kind`);
    const at = xyToPolar(pod.x, pod.y);
    assertCloseTo(at.r, PODS[i].r, 3, `pod ${i}'s posed radius`);
    assertCloseTo(at.deg, PODS[i].deg, 3, `pod ${i}'s posed angle`);
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
    assertCloseTo(at.deg, PODS[i].deg, 1, `pod ${i}'s angle in the fall`);
  });
});
