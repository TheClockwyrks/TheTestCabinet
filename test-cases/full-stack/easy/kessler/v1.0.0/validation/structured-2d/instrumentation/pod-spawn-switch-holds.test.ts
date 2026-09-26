// instrumentation/pod-spawn-switch-holds — with the switch off a destruction
// draws nothing.
//
// specs/instrumentation.md's driver table, for `podSpawn` off: "No draw is
// made, so no pod spawns, and an outcome `setNextPod` posed stays posed for the
// next draw that is made."
//
// THIS POINT IS THE FIRST HALF: no pod appears. A kind is posed through
// `setNextPod` first, so the destruction watched here is one that WOULD have
// shed had the switch been on — and the watch runs long enough that a shed pod
// would be visibly falling. That the pose survives and the draw resumes from
// the next destruction is `pod-spawn-switch-resumes`.
//
// `waveAdvance` stays off, per isolate(), so emptying the one-target field never
// clears.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { shedDestruction } from "./shed";

/** The kind posed for the draw the held destruction must not make. */
const POSED_KIND = "shield";

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
  isolate(h);
  h.debug.setNextPod(POSED_KIND);

  const later = await captureReplay(h, "held", async () => {
    const held = await shedDestruction(h, 0);
    assertLength(held.pods, 0, "pods on the held destruction's tick");
    h.debug.clearBalls();
    return h.tick(WATCH_TICKS);
  });
  assertLength(later.pods, 0, "pods after the held destruction");
  assertEqual(
    later.nextPod,
    POSED_KIND,
    "the posed outcome, still standing because no draw was made",
  );
});
