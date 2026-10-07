// field/containment-preserves-speed — a containment reflection preserves the
// ball's speed.
//
// specs/deflector-and-ball.md, on every reflection off a surface other than
// the deflector: step 3 of the pipeline is "Renormalize the speed to the speed
// the ball arrived with", and the ball-motion section states the same rule
// from the other side: "Every other reflection preserves the speed the ball
// arrived with." The posed speed is 333 — deliberately no wave's ball speed —
// so a build that runs every reflection through the deflector bounce's
// set-to-wave-speed step 4 fails by the figure it substitutes.
//
// THE WORLD IS ONE BALL AND THE FIELD, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength, assertLessThan } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Outbound at a speed no wave formula produces, crossing 472 on tick one. */
const POSE = { r: 470, thetaDeg: 310, speed: 333, offDeg: 25 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the reflection at exactly the arrival speed", async () => {
  await isolate(h);
  await spawnAimed(h, POSE.r, POSE.thetaDeg, POSE.speed, POSE.offDeg);

  const after = await captureReplay(h, "speed", () => h.tick(1));

  const balls = unparked(after);
  assertLength(balls, 1, "the one posed ball is still the only ball");
  const read = readBall(balls[0]);
  assertLessThan(read.vr, 0, "the ball did reflect off the containment field");
  assertCloseTo(
    read.speed,
    POSE.speed,
    2,
    "the outgoing speed is the speed the ball arrived with",
  );
});
