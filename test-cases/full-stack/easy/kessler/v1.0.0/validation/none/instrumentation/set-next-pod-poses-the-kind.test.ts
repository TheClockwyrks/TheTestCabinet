// instrumentation/set-next-pod-poses-the-kind — the posed kind reads back and
// the next draw sheds it.
//
// specs/instrumentation.md, `setNextPod(kind)`: "The next destruction that
// makes a draw sheds a pod of `kind` at the spawn point specs/pods.md fixes ...
// in place of the random outcome", and "The snapshot reports the pose as
// `nextPod`". The check poses a kind, reads it back, stages one destruction
// with the pod draw on, and reads the kind the destruction shed. A build that
// ignores the pose sheds nothing three times in four, or another kind.
//
// THE WORLD IS ONE TARGET AND ONE BALL, per isolate(), with the pod draw
// switched back on because the draw's outcome IS the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** A kind the odds alone would shed on about one destruction in twenty. */
const POSED_KIND = "narrow";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads the posed kind back and sheds it from the next draw", async () => {
  await isolate(h);
  await h.debug.setPodSpawn(true);
  await h.debug.setNextPod(POSED_KIND);
  assertEqual((await h.snapshot()).nextPod, POSED_KIND, "nextPod as posed");

  const shed = await captureReplay(h, "posed-shed", async () => {
    const destroyed = await shedDestruction(h, 0);
    await h.debug.clearBalls();
    await h.tick(12); // let the replay show the shed pod falling
    return destroyed;
  });
  assertLength(shed.pods, 1, "the pod the destruction shed");
  assertEqual(shed.pods[0].kind, POSED_KIND, "the shed kind against the pose");
});
