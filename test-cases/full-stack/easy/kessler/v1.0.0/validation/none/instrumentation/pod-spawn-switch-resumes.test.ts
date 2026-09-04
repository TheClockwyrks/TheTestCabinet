// instrumentation/pod-spawn-switch-resumes — the held destruction consumed
// nothing, so the seeded stream resumes exactly where it stood.
//
// specs/instrumentation.md's driver table, for `podSpawn` off: "the generator is
// not consumed, so ... the seeded sequence stays where it stands", and of a
// switch coming back on: "Turning one back on resumes that consequence from the
// next event onward."
//
// THE SEQUENCE IS COMPUTED FROM THE SPECIFICATION, not read off the build:
// specs/pods.md fixes the stream as mulberry32 under the session seed, one `u1`
// per destruction and a kind `u2` when it sheds, so what seed 7's first draw
// must shed is known here. A first destruction runs with the switch off; the
// switch then comes back on and a second destruction runs, and its draw must
// still be the seed's FIRST. A build whose held destruction consumed the stream
// reads later values there — seed 7's second and third draws shed nothing — and
// shows no pod, or the wrong kind. That the held destruction shed no pod is
// `pod-spawn-switch-holds`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { podSequence } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** The session seed: specs/pods.md's stream sheds on seed 7's FIRST draw. */
const SEED = 7;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the seed's first pod from the destruction after the held one", async () => {
  await isolate(h, SEED);
  const expected = podSequence(SEED, 1)[0];
  if (expected === null) {
    return fail("a seed whose first draw sheds a pod", "seed 7 shed nothing");
  }

  await shedDestruction(h, 0);
  await h.debug.clearBalls();

  await h.debug.setPodSpawn(true);
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
