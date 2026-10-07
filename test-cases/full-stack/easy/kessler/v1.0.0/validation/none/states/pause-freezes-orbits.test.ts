// states/pause-freezes-orbits — while paused, the ring angles hold however
// much time passes.
//
// specs/screens.md: "Pausing freezes the whole simulation: the ring orbits,
// the effect and interstitial timers, the falling pods, the balls in flight,
// and the ball sprite's animation all hold exactly as the pausing tick left
// them." The angles are compared exactly: a frozen orbit is the same number,
// not a nearby one.
//
// The world is the three rings and nothing else: isolate empties the field,
// and the rings keep the wave-1 orbit speeds a fresh session puts in force
// (ring 1's is 0 at every wave, so rings 2 and 3 are the moving ones; all
// three are read). A few playing ticks first carry the orbits off their start
// angles, so the pause catches rings genuinely mid-orbit.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import {
  advanceTicks,
  captureReplay,
  isolate,
  openHarness,
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

it("holds every ring angle while paused", async () => {
  await isolate(h);
  await advanceTicks(h, 5);

  await h.debug.setScreen("paused");
  const paused = await h.snapshot();
  assertEqual(paused.screen, "paused", "the screen the orbits freeze on");
  assertLength(paused.rings, 3, "the rings the pause catches");

  await captureReplay(h, "frozen-orbits", () => advanceTicks(h, HELD_TICKS));

  const after = await h.snapshot();
  for (const [i, ring] of after.rings.entries()) {
    assertEqual(
      ring.angleDeg,
      paused.rings[i].angleDeg,
      `ring ${i + 1}'s angle after ${HELD_TICKS} ticks of pause`,
    );
  }
});
