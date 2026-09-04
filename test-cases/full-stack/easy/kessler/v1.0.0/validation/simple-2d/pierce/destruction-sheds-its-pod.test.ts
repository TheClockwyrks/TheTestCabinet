// pierce/destruction-sheds-its-pod — a piercing destruction runs the salvage pod
// draw.
//
// specs/pods.md, "pierce": "The destruction otherwise resolves exactly as
// specs/rings.md states, so it plays its cue and particle, runs the pod draw,
// and can clear the wave." This point is the draw; that such a destruction can
// CLEAR THE WAVE is `destruction-clears-the-wave`, and a build may resolve one
// consequence and not the other.
//
// THE SHED KIND IS COMPUTED FROM THE SPECIFICATION. specs/pods.md fixes the
// stream as mulberry32 under the session seed, and seed 7's first draw sheds, so
// the pod that must appear is known here rather than read off the build: a
// destruction that ran no draw sheds nothing, and one that ran the wrong draw
// sheds the wrong kind.
//
// THE WORLD IS ONE TARGET AND ONE BALL, per isolate(), with exactly one held
// consequence — the pod draw — switched back on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  PIERCE_DURATION,
  armPierce,
  enablePodSpawn,
  firstShedKind,
  outboundBall,
  poseIsolated,
  poseRingTwoTarget,
  ringTwoTarget,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 3;
/** A session seed whose FIRST pod draw sheds (u1 < 0.25). */
const SEED = 7;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sheds the pod the seeded stream's first draw fixes", async () => {
  await poseIsolated(h, SEED);
  await enablePodSpawn(h);
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
    firstShedKind(SEED),
    "the kind the seeded stream's first draw fixes",
  );
});
