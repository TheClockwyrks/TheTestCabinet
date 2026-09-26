// bounce/clamp-negative — a rotated velocity past -60 degrees from the
// outward radial leaves at exactly -60.
//
// specs/deflector-and-ball.md, "The deflector bounce", step 3: "Clamp: let a
// be the signed angle from n to the rotated velocity. The outgoing direction
// uses a clamped to [-60, +60] degrees, sign preserved." The pose brings the
// ball in at -55 degrees from the inward radial with a -15-degree offset, so
// the mirror-plus-english direction sits at -55 - 1.2 * 15 = -73 degrees from
// n — 13 degrees past the bound on the negative side — and must leave at -60
// exactly, the sign preserved.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate(). TOL_ANGLED_DEG
// covers the tick-sized slack in where a build reads "the ball's center"; a
// build that never clamps leaves ~13 degrees out, several tolerances away.

import { afterEach, beforeEach, it } from "vitest";
import { BOUNCE_CLAMP_DEG } from "../constants";
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
/** The ball's offset from the deflector's center, toward -theta. */
const OFFSET_DEG = -15;
/** The approach's signed angle from the inward radial, toward -theta. */
const BETA_DEG = -55;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clamps a -73-degree rotated velocity to -60 from the radial", async () => {
  const pose = await poseAngledApproach(h, PADDLE_DEG, OFFSET_DEG, BETA_DEG);

  const after = await captureReplay(h, "bounce", async () => {
    const bounced = await h.tick(pose.ticks);
    await h.tick(8); // let the replay show the ball flying back out
    return bounced;
  });

  assertAngleClose(
    ballHeadingDeg(soleBall(after)),
    pose.thetaDeg - BOUNCE_CLAMP_DEG,
    TOL_ANGLED_DEG,
    "the outgoing heading, held to -60 degrees from the outward radial",
  );
});
