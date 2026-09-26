// pierce/destruction-sheds-its-pod — a piercing destruction runs the salvage pod
// draw.
//
// specs/pods.md, "pierce": "The destruction otherwise resolves exactly as
// specs/rings.md states, so it plays its cue and particle, runs the pod draw,
// and can clear the wave." This point is the draw; that such a destruction can
// CLEAR THE WAVE is `destruction-clears-the-wave`, and a build may resolve one
// consequence and not the other.
//
// THE DRAW'S OUTCOME IS POSED. specs/instrumentation.md's `setNextPod` makes
// "the next destruction that makes a draw" shed the posed kind, so the pod that
// must appear is known here rather than left to the odds: a destruction that
// ran no draw sheds nothing, and one that ran it sheds the posed kind.
//
// THE WORLD IS ONE TARGET AND ONE BALL, per isolate(), with exactly one held
// consequence — the pod draw — switched back on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  enablePodSpawn,
  outboundBall,
  PIERCE_DURATION,
  poseIsolated,
  poseRingTwoTarget,
  ringTwoTarget,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 3;
/** The outcome posed for the destruction's draw. */
const POSED_KIND = "multiball";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sheds the pod posed for the destruction's draw", async () => {
  await poseIsolated(h);
  await enablePodSpawn(h);
  await h.debug.setNextPod(POSED_KIND);
  await armPierce(h, PIERCE_DURATION);
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2, freeze: true });
  await outboundBall(h, arcDeg, 341);

  const after = await captureReplay(h, "shed", async () => {
    const destroyed = await h.tick(4); // the crossing of 352 resolves on tick 3
    await h.tick(8); // let the replay show the shed pod falling
    return destroyed;
  });

  assertUndefined(ringTwoTarget(after, SLOT), "the target was destroyed");
  assertLength(after.pods, 1, "the destruction's draw ran and shed a pod");
  assertEqual(
    after.pods[0]?.kind,
    POSED_KIND,
    "the kind posed for the destruction's draw",
  );
});
