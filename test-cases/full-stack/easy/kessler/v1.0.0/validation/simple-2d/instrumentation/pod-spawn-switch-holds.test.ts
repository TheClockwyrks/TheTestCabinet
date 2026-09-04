// instrumentation/pod-spawn-switch-holds — with the switch off a destruction
// draws nothing.
//
// specs/instrumentation.md's driver table, for `podSpawn` off: "No draw is made
// and the generator is not consumed, so no pod spawns and the seeded sequence
// stays where it stands."
//
// THIS POINT IS THE FIRST HALF: no pod appears. The seed is one whose FIRST draw
// sheds a pod, computed from specs/pods.md's own stream rather than read off the
// build, so the destruction watched here is one that WOULD have shed had the
// switch been on — and the watch runs long enough that a shed pod would be
// visibly falling. That the generator was not consumed either is
// `pod-spawn-switch-resumes`.
//
// `waveAdvance` stays off, per isolate(), so emptying the one-target field never
// clears.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, fail } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { podSequence } from "./rng";
import { shedDestruction } from "./shed";

/** The session seed: specs/pods.md's stream sheds on seed 7's FIRST draw. */
const SEED = 7;

/** Ticks watched for a pod that must not appear. */
const WATCH_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sheds nothing from a destruction that would have drawn a pod", async () => {
  isolate(h, SEED);
  if (podSequence(SEED, 1)[0] === null) {
    return fail("a seed whose first draw sheds a pod", "seed 7 shed nothing");
  }

  const later = await captureReplay(h, "held", async () => {
    const held = await shedDestruction(h, 0);
    assertLength(held.pods, 0, "pods on the held destruction's tick");
    h.debug.clearBalls();
    return h.tick(WATCH_TICKS);
  });
  assertLength(later.pods, 0, "pods after the held destruction");
});
