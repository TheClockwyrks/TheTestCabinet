// presentation/burnup-at-ball — the burn-up plays at a ball reaching the planet.
//
// specs/field.md: "In a tick where a ball's center radius reaches `78` or less,
// the ball burns up: it is removed, the burn-up particle system spawns at it".
// specs/assets.md fires `assets/particles/burnup.json` at "a ball or pod reaching
// the planet", played live through the case's particle player.
//
// THE BALL AND THE POD ARE SEPARATE POINTS, because a build that fires the
// system for one body and not the other must grade differently from one that
// fires it for neither.
//
// THE WORLD IS THE ONE FALLING BALL, so its burn-up is the last live ball's and
// reads as the tick's life loss — the event's own signature, never a tick count.
// How the playing is read is `played.ts`.

import { afterEach, beforeEach, it } from "vitest";
import { ballSpeed, START_LIVES } from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnBallPolar,
  type Harness,
} from "../harness";
import { assertPlayed, sweepFor } from "./played";

/** The ball falls from 130 to 78 at 4 units a tick: 13 ticks, plus margin. */
const SWEEP_FRAMES = 25;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("composites the burn-up on the ball's own tick", async () => {
  await isolate(h);
  // Straight inward from 130: reaching 78 on the thirteenth tick. It is the
  // last live ball, so the burn-up reads as the tick's life loss.
  await spawnBallPolar(h, 130, 45, ballSpeed(1), 180);

  const swept = await captureReplay(h, "burnup-ball", () =>
    sweepFor(h, SWEEP_FRAMES, (s) => s.lives < START_LIVES),
  );
  assertPlayed(swept, "the ball's burn-up");
});
