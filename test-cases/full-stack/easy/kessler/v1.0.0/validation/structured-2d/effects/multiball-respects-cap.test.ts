// effects/multiball-respects-cap — as many of multiball's two balls launch as
// the six-ball cap admits: at five live balls one launches, and at the cap
// the catch launches nothing.
//
// specs/pods.md: "As many of the two launch as the six-ball cap admits ... At
// the cap the catch scores and launches nothing." The cap is the exact "at
// most `6` balls are in play at once" of specs/deflector-and-ball.md, so both
// readings are exact counts.
//
// THE WORLD IS FIVE POSED BALLS AND ONE POD, then six and another. The five
// bystander balls sit far from every contact radius, barely moving outward,
// so across the two catch ticks nothing but the catches can change the count.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength } from "../assert";
import {
  CAP,
  close,
  dropPod,
  open,
  record,
  snap,
  spawnBallAt,
  world,
  type Harness,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("launches one ball at five, and none at the cap", async () => {
  await world(h);
  for (const theta of [150, 180, 210, 240, 270]) {
    await spawnBallAt(h, 250, theta, 10, 0);
  }
  assertLength((await snap(h)).balls, 5, "the five posed live balls");

  const atFive = await record(h, "multiball-cap", () =>
    dropPod(h, "multiball"),
  );
  assertLength(atFive.pods, 0, "the first pod after its catch tick");
  assertLength(
    atFive.balls,
    CAP,
    "at five live balls exactly one of the two launches",
  );

  const atCap = await dropPod(h, "multiball");
  assertLength(atCap.pods, 0, "the second pod after its catch tick");
  assertLength(atCap.balls, CAP, "at the cap the catch launches nothing");
});
