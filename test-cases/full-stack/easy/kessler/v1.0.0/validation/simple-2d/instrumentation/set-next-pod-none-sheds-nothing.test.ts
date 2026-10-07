// instrumentation/set-next-pod-none-sheds-nothing — a posed `none` makes the
// next draw shed nothing.
//
// specs/instrumentation.md, `setNextPod(kind)`: `kind` is a pod kind "or
// `none`", and the next destruction that makes a draw "sheds nothing for
// `none`, in place of the random outcome". The check poses `none`, stages one
// destruction with the pod draw on, and watches long enough that a shed pod
// would be visibly falling. A build that ignores the pose sheds a pod on about
// one destruction in four, which is the odds this check would flake at if it
// did not pose; with the pose, a shed pod is a fault.
//
// THE WORLD IS ONE TARGET AND ONE BALL, per isolate(), with the pod draw
// switched back on because the draw's outcome IS the requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** Ticks watched for a pod that must not appear. */
const WATCH_TICKS = 20;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sheds nothing from the draw after a posed none", async () => {
  isolate(h);
  h.debug.setPodSpawn(true);
  h.debug.setNextPod("none");
  assertEqual(h.snapshot().nextPod, "none", "nextPod as posed");

  const later = await captureReplay(h, "posed-none", async () => {
    const destroyed = await shedDestruction(h, 0);
    assertLength(destroyed.pods, 0, "pods on the destruction's tick");
    h.debug.clearBalls();
    return h.tick(WATCH_TICKS);
  });
  assertLength(later.pods, 0, "pods after the destruction");
});
