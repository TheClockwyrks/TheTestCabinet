// field/containment-decay — orbital decay turns a reflected ball exactly 6
// degrees toward the radial.
//
// specs/deflector-and-ball.md, step 4 of the reflection pipeline: "Orbital
// decay: rotate the velocity toward the local radial axis by `min(6, |phi|)`
// degrees, where `phi` is the signed angle from the nearer radial direction,
// outward or inward, to the velocity. The rotation reduces `|phi|`." A ball
// arriving 40 degrees off the outward radial reflects to 40 degrees off the
// INWARD radial (specular keeps the tangential component), and |phi| = 40 > 6,
// so the decay step rotates it exactly 6 degrees: the outgoing heading is 34
// degrees off the inward radial, on the same tangential sign. The reading
// allows half a degree to each side: the radial axis is read "at the ball's
// center", and the center's angle moves about a third of a degree across the
// crossing tick, so where within the tick a build evaluates the axis moves
// the reading by that much — while a no-decay build (40 off) and a
// full-6-past-it build stay well outside the window.
//
// The containment field is where this pipeline is read cleanly: no ring kick
// (step 2 names only targets in moving rings), and the renormalize step
// cannot move a heading. THE WORLD IS ONE BALL AND THE FIELD, per isolate().

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertLength, assertLessThan } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { readBall, spawnAimed, unparked } from "./reading";

/** Outbound 40 degrees off the radial — beyond decay's 6-degree bite. */
const POSE = { r: 470, thetaDeg: 125, speed: 240, offDeg: 40 };

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rotates the reflected velocity exactly 6 degrees toward the radial", async () => {
  isolate(h);
  spawnAimed(h, POSE.r, POSE.thetaDeg, POSE.speed, POSE.offDeg);

  const after = await captureReplay(h, "decay", () => h.tick(1));

  const balls = unparked(after);
  assertLength(balls, 1, "the one posed ball is still the only ball");
  const read = readBall(balls[0]);
  assertLessThan(read.vr, 0, "the ball did reflect off the containment field");
  assertBetween(
    read.offInwardDeg,
    -(POSE.offDeg - 6) - 0.5,
    -(POSE.offDeg - 6) + 0.5,
    "the reflected 40-degree heading, decayed exactly 6 degrees toward the " +
      "inward radial with its sign kept",
  );
});
