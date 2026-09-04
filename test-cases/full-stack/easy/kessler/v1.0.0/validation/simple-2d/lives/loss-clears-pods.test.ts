// lives/loss-clears-pods — a life loss removes every falling pod.
//
// specs/field.md, in the life-loss check: "every timed effect, the shield, and
// every pod are cleared"; specs/pods.md's lifecycle says the same — "every
// falling pod is removed". Two pods are posed falling far from the deflector's
// span and far above the burn-up threshold, so across the watched ticks
// neither can be caught or burn on its own, and the emptying read on the loss
// tick is the loss's work.
//
// THE WORLD IS THE DOOMED BALL AND TWO PODS. No targets; the pod generator's
// own draws are already off in the isolated world.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { START_LIVES } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { DOOM_TICKS, spawnDoomedBall } from "./loss";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h.dispose();
});

it("removes every falling pod on the loss", async () => {
  isolate(h);
  spawnPodPolar(h, "widen", 440, 0);
  spawnPodPolar(h, "shield", 460, 180);
  spawnDoomedBall(h);
  const posed = h.snapshot();
  assertLength(posed.pods, 2, "the pods posed falling");

  const run = await captureReplay(h, "loss", () =>
    h.until((s) => s.lives !== START_LIVES, { maxTicks: DOOM_TICKS }),
  );

  assertTrue(run.hit, "a life loss within the fall's ticks");
  assertLength(run.snapshot.pods, 0, "the falling pods on the loss tick");
  assertEqual(
    run.snapshot.lives,
    START_LIVES - 1,
    "the loss the emptying rode on",
  );
});
