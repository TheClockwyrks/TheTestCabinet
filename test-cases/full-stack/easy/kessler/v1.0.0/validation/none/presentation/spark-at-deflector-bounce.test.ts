// presentation/spark-at-deflector-bounce — the impact spark plays at a deflector
// bounce.
//
// specs/deflector-and-ball.md: "The bounce plays the `paddle-bounce` cue and
// spawns the impact spark particle system at the contact." specs/assets.md fires
// `assets/particles/spark.json` there, played live through the case's particle
// player.
//
// EACH OF THE THREE REFLECTIONS THE SPARK FIRES AT IS ITS OWN POINT — the
// deflector, the containment field, and the shield ring — because a build that
// sparks at one and not another must grade differently from one that sparks
// nowhere.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, and the bounce is found by its own
// signature — the radial velocity turning outward — rather than by a tick count.
// How the playing is read is `played.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { ballSpeed, PADDLE_START_ANGLE } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("composites the spark on the bounce's tick", async () => {
  await isolate(h);
  // Dead-center on the span, straight inward: crossing 194 on the third tick.
  await spawnBallPolar(h, 205, PADDLE_START_ANGLE, ballSpeed(1), 180);

  const swept = await captureReplay(h, "spark-paddle", () =>
    sweepFor(h, SWEEP_FRAMES, (s) => radialSpeed(s) > 0),
  );
  assertPlayed(swept, "the bounce's outward turn");
});
