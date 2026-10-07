// states/pause-freezes-pods — while paused, a falling pod holds its position
// however much time passes.
//
// specs/screens.md: "Pausing freezes the whole simulation: the ring orbits,
// the effect and interstitial timers, the falling pods, the balls in flight,
// and the ball sprite's animation all hold exactly as the pausing tick left
// them." "Hold exactly" is the spec's own figure, so the pod's position is
// compared exactly.
//
// The world is one falling pod and nothing else: isolate clears the field and
// holds both driver switches, and the pod is spawned far above the catch and
// burn-up radii, so across the few ticks that put it in motion and the whole
// pause nothing can consume it.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { HELD_TICKS } from "./still";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a falling pod exactly where the pausing tick left it", async () => {
  await isolate(h);
  await spawnPodPolar(h, "widen", 420, 45);
  await advanceTicks(h, 3);

  await h.debug.setScreen("paused");
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the pod freezes on");
  assertLength(paused.pods, 1, "the pod the pause catches");

  await captureReplay(h, "frozen-pods", () => advanceTicks(h, HELD_TICKS));

  assertDeepEqual(
    (await h.snapshot()).pods,
    paused.pods,
    `the falling pod after ${HELD_TICKS} ticks of pause`,
  );
});
