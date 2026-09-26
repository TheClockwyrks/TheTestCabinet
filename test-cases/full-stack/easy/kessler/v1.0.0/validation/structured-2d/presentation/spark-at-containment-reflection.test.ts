// presentation/spark-at-containment-reflection — the impact spark plays at a
// containment field reflection.
//
// specs/field.md, on the containment: the reflection "plays the `field-bounce`
// cue, and it spawns the impact spark particle system at the contact."
// specs/assets.md fires `assets/particles/spark.json` there, played live through
// the case's particle player.
//
// EACH OF THE THREE REFLECTIONS THE SPARK FIRES AT IS ITS OWN POINT — the
// deflector, the containment field, and the shield ring — because a build that
// sparks at one and not another must grade differently from one that sparks
// nowhere.
//
// THE WORLD IS ONE BALL AND THE FIELD, per isolate(): with no targets, the ring
// annuli on the outbound approach are inert vacuum. The reflection is found by
// its own signature — the radial velocity turning inward — rather than by a tick
// count. How the playing is read is `played.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { ballSpeedAtWave } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { assertPlayed, radialSpeed, sweepFor } from "./played";

/** A few frames of margin past the posed crossing. */
const SWEEP_FRAMES = 15;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("composites the spark on the containment reflection's tick", async () => {
  isolate(h);
  // Straight outward from 440: crossing 472 on the eighth tick.
  spawnBallPolar(h, 440, 0, ballSpeedAtWave(1), 0);

  const swept = await captureReplay(h, "spark-field", () =>
    sweepFor(h, SWEEP_FRAMES, (s) => radialSpeed(s) < 0),
  );
  assertPlayed(swept, "the containment's inward turn");
});
