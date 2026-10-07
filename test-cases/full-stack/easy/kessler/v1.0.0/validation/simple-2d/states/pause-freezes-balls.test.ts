// states/pause-freezes-balls — while paused, no ball moves however much time
// passes.
//
// specs/screens.md: "Pausing freezes the whole simulation: the ring orbits,
// the effect and interstitial timers, the falling pods, the balls in flight,
// and the ball sprite's animation all hold exactly as the pausing tick left
// them." "Hold exactly" is the spec's own figure, so the reading is exact
// equality of every ball's position and velocity rather than a tolerance —
// nothing here is a contact boundary, just a frozen body that must not move.
//
// THE WORLD IS TWO BALLS IN OPEN FLIGHT AND NOTHING ELSE. Targets, pods, and
// both driver switches are held by isolate, and both balls fly far from every
// contact radius across the few playing ticks that put them in motion, so
// nothing but the pause decides what they do. The pause is entered through
// the surface — setScreen("paused") enters "exactly as Escape does during
// play" — so a broken pause KEY fails its own navigation point, not this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { HELD_TICKS } from "./still";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds every ball exactly where the pausing tick left it", async () => {
  isolate(h);
  // One ball outbound, one crossing tangentially: both in flight, neither
  // within reach of a contact radius in the few ticks run before the pause.
  spawnBallPolar(h, 300, 20, 240, 0);
  spawnBallPolar(h, 320, 200, 0, 240);
  await advanceTicks(h, 3);

  h.debug.setScreen("paused");
  const paused = h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the balls freeze on");
  assertLength(paused.balls, 2, "the balls the pause catches");

  await captureReplay(h, "frozen-balls", () => advanceTicks(h, HELD_TICKS));

  assertDeepEqual(
    h.snapshot().balls,
    paused.balls,
    `every ball's position and velocity after ${HELD_TICKS} ticks of pause`,
  );
});
