// instrumentation/draw-pod-changes-nothing — a run of draws leaves the game
// exactly as it stood.
//
// specs/instrumentation.md, `drawPod()`: "Nothing else happens: no pod is
// added, no cue sounds, and a posed `nextPod` is left where it stands." The
// check poses a busy world — balls, targets, a falling pod, a running timer,
// the shield, and a posed `nextPod` — snapshots it, makes a run of draws, and
// snapshots it again: the two reads are identical to the float. A build whose
// `drawPod` spawns the pod it drew, consumes the pose, or advances anything
// fails on the field that moved.
//
// NO TICK RUNS between the two reads, so the draws are the only thing that
// happened to the game; the one tick after the second read is for the still.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import {
  captureStill,
  drawPods,
  isolate,
  openHarness,
  spawnBallPolar,
  spawnPodPolar,
  type Harness,
} from "../harness";

/** Calls made between the two reads. */
const DRAWS = 200;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the posed world untouched by a run of draws", async () => {
  isolate(h);
  h.debug.spawnTarget(1, 2, 1);
  h.debug.spawnTarget(2, 5, 2);
  spawnBallPolar(h, 250, 180, 300, 45);
  spawnPodPolar(h, "widen", 420, 300);
  h.debug.setEffectTicks("pierce", 200);
  h.debug.setShield(true);
  h.debug.setScore(1234);
  h.debug.setNextPod("multiball");

  const before = h.snapshot();
  await drawPods(h, DRAWS);
  const after = h.snapshot();
  await h.tick(1);
  captureStill(h, "unchanged");

  assertDeepEqual(after, before, "the snapshot after the draws against before");
});
