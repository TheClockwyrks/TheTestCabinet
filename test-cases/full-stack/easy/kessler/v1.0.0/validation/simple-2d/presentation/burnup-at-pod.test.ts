// presentation/burnup-at-pod — the burn-up plays at a pod reaching the planet.
//
// specs/field.md: "A pod whose center radius reaches `78` or less burns up the
// same way, as specs/pods.md states", and specs/pods.md: "the burn-up particle
// system plays at the pod". specs/assets.md fires
// `assets/particles/burnup.json` at "a ball or pod reaching the planet", played
// live through the case's particle player.
//
// THE BALL AND THE POD ARE SEPARATE POINTS, because a build that fires the
// system for one body and not the other must grade differently from one that
// fires it for neither.
//
// THE WORLD IS THE ONE FALLING POD, so its burn-up reads as `pods` emptying —
// the event's own signature, never a tick count. How the playing is read is
// `played.ts`.

import { afterEach, beforeEach, it } from "vitest";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";
import { assertPlayed, sweepFor } from "./played";

/** The pod falls from 130 to 78 at 2 units a tick: 26 ticks, plus margin. */
const SWEEP_FRAMES = 35;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("composites the burn-up on the pod's own tick", async () => {
  isolate(h);
  // Falling inward from 130 at the pod fall speed: reaching 78 in 26 ticks.
  spawnPodPolar(h, "widen", 130, 200);

  const swept = await captureReplay(h, "burnup-pod", () =>
    sweepFor(h, SWEEP_FRAMES, (s) => s.pods.length === 0),
  );
  assertPlayed(swept, "the pod's burn-up");
});
