// field/containment-decay-to-radial — orbital decay never overshoots the
// radial.
//
// specs/deflector-and-ball.md, step 4 of the reflection pipeline, rotates the
// velocity toward the local radial axis "by `min(6, |phi|)` degrees", and "the
// rotation reduces `|phi|`". A ball arriving 4 degrees off the outward radial
// reflects to |phi| = 4 < 6 off the inward radial, so the decay step rotates
// by 4 degrees — exactly onto the radial, not 6 degrees past it. The outgoing
// velocity is the pure inward radial. The reading allows half a degree of
// axis slack (the center's angle moves slightly across the crossing tick),
// which still fails a build that skipped the decay (4 degrees off) or rotated
// the full 6 and overshot (2 degrees past, on the other sign).
//
// THE WORLD IS ONE BALL AND THE FIELD, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength, assertLessThan } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Outbound only 4 degrees off the radial — inside decay's 6-degree bite. */
const POSE = { r: 470, thetaDeg: 15, speed: 240, offDeg: 4 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("rotates a within-6-degrees reflection exactly onto the radial", async () => {
  await isolate(h);
  await spawnAimed(h, POSE.r, POSE.thetaDeg, POSE.speed, POSE.offDeg);

  const after = await captureReplay(h, "to-radial", () => h.tick(1));

  const balls = unparked(after);
  assertLength(balls, 1, "the one posed ball is still the only ball");
  const read = readBall(balls[0]);
  assertLessThan(read.vr, 0, "the ball did reflect off the containment field");
  assertBetween(
    read.offInwardDeg,
    -0.5,
    0.5,
    "min(6, |phi|) with |phi| = 4: rotated onto the inward radial, no " +
      "further",
  );
});
