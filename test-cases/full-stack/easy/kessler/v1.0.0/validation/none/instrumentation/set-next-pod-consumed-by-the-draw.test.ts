// instrumentation/set-next-pod-consumed-by-the-draw — the draw that sheds the
// pose consumes it.
//
// specs/instrumentation.md, `setNextPod(kind)`: "That draw consumes the pose,
// and every draw after it is random again until the next call", and the
// snapshot reports `nextPod` as "`null` once it is consumed". The check poses a
// kind, stages the destruction that takes it, and reads `nextPod` afterwards;
// then poses a second kind and reads that a second destruction sheds it, so a
// build that clears the field but never clears the pose, and a build whose
// second pose does not take, both fail here.
//
// THE WORLD IS ONE TARGET AND ONE BALL PER DESTRUCTION, per isolate(), with
// the pod draw switched back on because the draw's consumption of the pose IS
// the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** The two poses, distinct so the second shed is read against its own. */
const FIRST_KIND = "widen";
const SECOND_KIND = "shield";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the pose on the draw that sheds it", async () => {
  await isolate(h);
  await h.debug.setPodSpawn(true);
  await h.debug.setNextPod(FIRST_KIND);

  const first = await shedDestruction(h, 0);
  assertLength(first.pods, 1, "the pod the first destruction shed");
  assertEqual(first.pods[0].kind, FIRST_KIND, "the first shed kind");
  assertNull(first.nextPod, "nextPod once the draw consumed the pose");
  await captureStill(h, "consumed");

  await h.debug.clearBalls();
  await h.debug.clearPods();
  await h.debug.setNextPod(SECOND_KIND);
  const second = await shedDestruction(h, 3);
  assertLength(second.pods, 1, "the pod the second destruction shed");
  assertEqual(second.pods[0].kind, SECOND_KIND, "the second shed kind");
  assertNull(second.nextPod, "nextPod once the second draw consumed its pose");
});
