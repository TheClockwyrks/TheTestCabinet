// bounce/specular — a center-angle bounce is the pure mirror: radial
// reversed, tangential kept, no english.
//
// specs/deflector-and-ball.md, "The deflector bounce", step 1: "Specular:
// v' = v - 2 (v . n) n, with n the outward unit radial at the ball's center",
// and step 2 adds english of "1.2 * offset" degrees — zero at offset 0. A
// velocity at signed angle beta from the INWARD radial mirrors to the same
// signed angle beta from the OUTWARD radial: the radial component flips and
// the tangential one rides through, so the outgoing heading alone decides the
// formula.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR. isolate() clears targets, balls,
// and pods and holds both driver switches off, so the only contact on the
// board is the posed crossing of radius 194. The pose ends the crossing tick
// with the ball's center exactly on the deflector's center angle, and
// TOL_ANGLED_DEG covers the tick-sized slack in where a build reads "the
// ball's center"; a missing or mis-signed mirror is tens of degrees out.

import { afterEach, beforeEach, it } from "vitest";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  assertAngleClose,
  ballHeadingDeg,
  poseAngledApproach,
  soleBall,
  TOL_ANGLED_DEG,
} from "./pose";

/** The deflector's center angle for the pose. */
const PADDLE_DEG = 90;
/** The approach's signed angle from the inward radial, toward +theta. */
const BETA_DEG = 40;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("mirrors an offset-0 bounce: beta in, beta out, no english", async () => {
  const pose = await poseAngledApproach(h, PADDLE_DEG, 0, BETA_DEG);

  const after = await captureReplay(h, "bounce", async () => {
    const bounced = await h.tick(pose.ticks);
    await h.tick(8); // let the replay show the ball flying back out
    return bounced;
  });

  assertAngleClose(
    ballHeadingDeg(soleBall(after)),
    pose.thetaDeg + BETA_DEG,
    TOL_ANGLED_DEG,
    "the outgoing heading, the specular mirror of the approach",
  );
});
