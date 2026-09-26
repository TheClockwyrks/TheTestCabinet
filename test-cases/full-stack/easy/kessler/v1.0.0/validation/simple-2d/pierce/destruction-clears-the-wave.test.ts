// pierce/destruction-clears-the-wave — a piercing destruction that empties the
// rings fires the clearing event.
//
// specs/pods.md, "pierce": the destruction "resolves exactly as specs/rings.md
// states, so it ... can clear the wave." specs/rings.md fixes the event: "a hit
// from a ball destroys a target and leaves zero live targets across all three
// rings", at which "the `waveclear` interstitial begins". This point is the
// clearing; that such a destruction runs its POD DRAW is
// `destruction-sheds-its-pod`, and a build may resolve one consequence and not
// the other.
//
// THE WORLD IS ONE TARGET AND ONE BALL, per isolate(), with exactly one held
// consequence — the clearing — switched back on, so the ring the ball reaches
// holds the session's only live target.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  PIERCE_DURATION,
  armPierce,
  enableWaveAdvance,
  outboundBall,
  poseIsolated,
  poseRingTwoTarget,
} from "./stage";

/** The ring 2 slot the target is posed in. */
const SLOT = 3;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("begins the interstitial on the destruction that empties the rings", async () => {
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
