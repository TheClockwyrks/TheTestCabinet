// instrumentation/pod-spawn-switch-resumes — the held destruction made no draw,
// so the draw resumes, with the standing pose, from the next destruction.
//
// specs/instrumentation.md's driver table, for `podSpawn` off: "No draw is
// made, so no pod spawns, and an outcome `setNextPod` posed stays posed for the
// next draw that is made", and of a switch coming back on: "Turning one back
// on resumes that consequence from the next event onward."
//
// THE OUTCOME IS POSED, not left to the odds: a kind is posed, a first
// destruction runs with the switch off, the switch comes back on, and a second
// destruction runs — its draw must be the one that takes the pose. A build
// whose held destruction consumed the pose shows no pod, or a random kind,
// there; a build that never resumes shows nothing. That the held destruction
// shed no pod is `pod-spawn-switch-holds`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** The kind posed before the held destruction, for the resumed draw to take. */
const POSED_KIND = "pierce";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sheds the standing pose from the destruction after the held one", async () => {
  isolate(h);
  h.debug.setNextPod(POSED_KIND);

  await shedDestruction(h, 0);
  h.debug.clearBalls();

  h.debug.setPodSpawn(true);
  const resumed = await captureReplay(h, "resumed", () =>
    shedDestruction(h, 3),
  );
  assertLength(resumed.pods, 1, "the pod the resumed draw shed");
  assertEqual(
    resumed.pods[0].kind,
    POSED_KIND,
    "the shed kind against the standing pose",
  );
});
