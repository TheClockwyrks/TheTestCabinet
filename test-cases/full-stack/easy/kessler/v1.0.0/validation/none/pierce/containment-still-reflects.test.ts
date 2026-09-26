// pierce/containment-still-reflects — the containment field reflects a piercing
// ball.
//
// specs/pods.md, "pierce": "The deflector, the shield ring, and the containment
// field reflect a piercing ball exactly as they reflect any other." Each of the
// three surfaces is its own point, because a build that disables one of them
// under pierce and keeps the other two must grade differently from one that
// disables all three.
//
// THE READING IS THE SIGN OF THE RADIAL VELOCITY after the crossing tick: a
// build that let a piercing ball through the containment field would carry it
// outward off the stage. The exact reflection arithmetic is the `field` points'
// business, not this one's.
//
// THE WORLD IS ONE BALL AND THE FIELD, per isolate(): with no targets, the ring
// annuli on the outbound approach are inert vacuum.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThan } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  outboundBall,
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

it("reflects a piercing ball back inward", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  // Outward from radius 463: the crossing of contact radius 472 resolves on
  // tick 3 (radii 467, 471, 475).
  await outboundBall(h, 300, 463);

  const after = await captureReplay(h, "containment", async () => {
    const reflected = await h.tick(3);
    await h.tick(6); // let the replay show the ball heading back in
    return reflected;
  });

  assertLessThan(
    radialSpeedOf(soleBall(after)),
    0,
    "inward after the field bounce, pierce notwithstanding",
  );
});
