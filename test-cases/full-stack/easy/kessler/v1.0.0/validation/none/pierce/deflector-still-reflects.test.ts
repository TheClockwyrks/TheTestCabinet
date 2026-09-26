// pierce/deflector-still-reflects — the deflector bounces a piercing ball back
// out.
//
// specs/pods.md, "pierce": "The deflector, the shield ring, and the containment
// field reflect a piercing ball exactly as they reflect any other." Each of the
// three surfaces is its own point, because a build that disables one of them
// under pierce and keeps the other two must grade differently from one that
// disables all three.
//
// THE READING IS THE ONE FACT THAT SEPARATES A REFLECTION FROM A PASS-THROUGH:
// the sign of the radial velocity after the crossing tick. A build that lets
// pierce switch the deflector off sends the ball straight on to burn against the
// planet; the exact bounce arithmetic is the `bounce` points' business, not this
// one's.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  inboundBall,
  PIERCE_DURATION,
  poseIsolated,
  radialSpeedOf,
  soleBall,
} from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("bounces a piercing ball back out", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  // Straight down the deflector's boot angle (90) from radius 200: the
  // crossing of contact radius 194 resolves on tick 2 (196 to 192).
  await inboundBall(h, 90, 200);

  const after = await captureReplay(h, "deflector", async () => {
    const bounced = await h.tick(2);
    await h.tick(6); // let the replay show the ball flying back out
    return bounced;
  });

  assertGreaterThan(
    radialSpeedOf(soleBall(after)),
    0,
    "outward after the deflector bounce, pierce notwithstanding",
  );
});
