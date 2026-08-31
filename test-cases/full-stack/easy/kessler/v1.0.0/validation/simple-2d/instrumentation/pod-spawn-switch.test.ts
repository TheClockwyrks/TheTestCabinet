// instrumentation/pod-spawn-switch — with the switch off a destruction draws
// nothing and consumes nothing, so the seeded sequence resumes intact.
//
// WHAT THE SPECIFICATION FIXES. specs/instrumentation.md's driver table, for
// `podSpawn` off: "no draw is made and the generator is not consumed, so no pod
// spawns and the seeded sequence stays where it stands." The sequence itself is
// specs/pods.md's exactly — a mulberry32 stream under the session seed, one
// `u1` per destruction, a kind `u2` when it sheds — so what a seeded session
// must shed is computable from the specification alone.
//
// THE SCENE IS TWO DESTRUCTIONS UNDER SEED 7, whose FIRST draw sheds a `widen`
// pod. The first destruction runs with the switch off: no pod may appear, over
// ticks in which a drawn pod would visibly be falling. Then the switch comes
// back on and a second destruction runs: its draw must be the seed's FIRST —
// a `widen` pod — because the held destruction consumed nothing. A build whose
// held destruction consumed the stream reads later values there (seed 7's
// second and third draws shed nothing) and shows no pod, or the wrong kind.
//
// `waveAdvance` stays off, so emptying the one-target field never clears.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
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

it("draws nothing while off and resumes the sequence intact", async () => {
  isolate(h, SEED);
  const expected = podSequence(SEED, 1)[0];
  if (expected === null) {
    return fail("a seed whose first draw sheds a pod", "seed 7 shed nothing");
  }

  // Off: the destruction makes no draw.
  const held = await shedDestruction(h, 0);
  assertLength(held.pods, 0, "pods on the held destruction's tick");
  h.debug.clearBalls();
  const later = await h.tick(WATCH_TICKS);
  assertLength(later.pods, 0, "pods after the held destruction");

  // On: the next destruction's draw is still the seed's FIRST.
  h.debug.setPodSpawn(true);
  const resumed = await captureReplay(h, "resumed", () =>
    shedDestruction(h, 3),
  );
  assertLength(resumed.pods, 1, "the pod the resumed draw shed");
  assertEqual(
    resumed.pods[0].kind,
    expected,
    "the shed kind against the seed's first draw",
  );
});
