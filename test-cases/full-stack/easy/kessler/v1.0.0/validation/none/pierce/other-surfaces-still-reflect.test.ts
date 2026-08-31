// pierce/other-surfaces-still-reflect — pierce changes what happens at
// targets and nothing else: the deflector, the shield ring, and the
// containment field reflect a piercing ball like any other.
//
// specs/pods.md, "pierce": "The deflector, the shield ring, and the
// containment field reflect a piercing ball exactly as they reflect any
// other." Each check below poses a piercing ball on a radial line into one of
// the three surfaces and reads the one fact that separates a reflection from
// a pass-through: the sign of the radial velocity after the crossing tick. A
// build that lets pierce disable these surfaces sends the ball straight on
// (and, at the planet side, burns it up); the exact reflection arithmetic is
// graded by the bounce and field checks, not here.
//
// THE WORLD IS ONE BALL AND ONE SURFACE per check, per isolate(): no targets,
// so the ring annuli on the containment approach are inert vacuum.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLessThan } from "../assert";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  armPierce,
  inboundBall,
  outboundBall,
  PIERCE_DURATION,
  poseIsolated,
  radialSpeedOf,
  raiseShield,
  soleBall,
} from "./stage";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("the deflector still bounces a piercing ball back out", async () => {
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

it("the shield ring still reflects a piercing ball", async () => {
  await poseIsolated(h);
  await armPierce(h, PIERCE_DURATION);
  await raiseShield(h);
  // Inward from radius 106, away from the deflector's span: the crossing of
  // shield contact radius 100 resolves on tick 2 (102 to 98).
  await inboundBall(h, 200, 106);

  const after = await captureReplay(h, "shield", async () => {
    const reflected = await h.tick(2);
    await h.tick(6); // let the replay show the ball flying back out
    return reflected;
  });

  assertGreaterThan(
    radialSpeedOf(soleBall(after)),
    0,
    "outward after the shield reflection, pierce notwithstanding",
  );
});

it("the containment field still reflects a piercing ball", async () => {
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
