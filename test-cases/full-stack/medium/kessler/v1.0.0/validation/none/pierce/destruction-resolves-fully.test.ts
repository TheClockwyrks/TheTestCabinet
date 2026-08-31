// pierce/destruction-resolves-fully — a piercing destruction is a real one:
// the pod draw runs, and one that leaves zero live targets clears the wave.
//
// specs/pods.md, "pierce": "The destruction otherwise resolves exactly as
// specs/rings.md states, so it plays its cue and particle, runs the pod draw,
// and can clear the wave." The first check re-enables podSpawn over a seed
// (7) whose first draw sheds — mulberry32(7) gives u1 ~= 0.0117 < 0.25, then
// u2 ~= 0.0620, a widen — and reads the shed pod off the destruction, kind
// and all: the draw ran and consumed the stream exactly as an ordinary
// destruction's would. The second re-enables waveAdvance over a field whose
// ONLY live target the piercing ball destroys, and reads the clearing event:
// specs/rings.md, "a hit from a ball destroys a target and leaves zero live
// targets across all three rings" begins the waveclear interstitial.
//
// THE WORLD IS ONE TARGET AND ONE BALL per check, per isolate(), with
// exactly one held consequence switched back on per check — the one whose
// resolution that check is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  enablePodSpawn,
  enableWaveAdvance,
  firstShedKind,
  outboundBall,
  PIERCE_DURATION,
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

afterEach(async () => {
  await h.dispose();
});

it("runs the salvage pod draw at the piercing destruction", async () => {
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

it("a piercing destruction that leaves zero live targets clears the wave", async () => {
  await poseIsolated(h);
  await enableWaveAdvance(h);
  await armPierce(h, PIERCE_DURATION);
  const arcDeg = await poseRingTwoTarget(h, SLOT, { hp: 2, freeze: true });
  await outboundBall(h, arcDeg, 341);

  const after = await captureReplay(h, "clear", async () => {
    const cleared = await h.tick(4); // the crossing of 352 resolves on tick 3
    await h.tick(8); // let the replay show the interstitial beginning
    return cleared;
  });

  assertEqual(
    after.screen,
    "waveclear",
    "the clearing event fired on the piercing destruction",
  );
});
