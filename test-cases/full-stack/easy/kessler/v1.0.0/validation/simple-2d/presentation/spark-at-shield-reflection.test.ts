// presentation/spark-at-shield-reflection — the impact spark plays at a shield
// ring reflection.
//
// specs/pods.md, on the shield: "The reflection plays the `shield-reflect` cue
// and the impact spark particle system at the contact." specs/assets.md fires
// `assets/particles/spark.json` there, played live through the case's particle
// player.
//
// EACH OF THE THREE REFLECTIONS THE SPARK FIRES AT IS ITS OWN POINT — the
// deflector, the containment field, and the shield ring — because a build that
// sparks at one and not another must grade differently from one that sparks
// nowhere.
//
// THE WORLD IS ONE BALL AND THE SHIELD, and the reflection is found by its own
// signature — the shield consuming itself — rather than by a tick count. How the
// playing is read is `played.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { ballSpeedAtWave } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { assertPlayed, sweepFor } from "./played";

/** A few frames of margin past the posed crossing. */
const SWEEP_FRAMES = 15;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("composites the spark on the shield reflection's tick", async () => {
  isolate(h);
  h.debug.setShield(true);
  // Straight inward from 130: crossing the shield's 100 on the eighth tick.
  spawnBallPolar(h, 130, 45, -ballSpeedAtWave(1), 0);

  const swept = await captureReplay(h, "spark-shield", () =>
    sweepFor(h, SWEEP_FRAMES, (s) => !s.effects.shieldActive),
  );
  assertPlayed(swept, "the shield's consuming reflection");
});
