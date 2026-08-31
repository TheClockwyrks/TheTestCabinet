// bounce/english-wrap-aware — an offset across the 0/360 seam is the small
// signed angle, not a near-full turn.
//
// specs/deflector-and-ball.md, "The deflector bounce", step 2 takes "the
// signed wrap-aware angular offset in degrees of the ball's center from the
// deflector's center angle", and specs/field.md's angular conventions fix
// every such offset "wrap-aware, taken in [-180, 180)". With the deflector
// centered at 2 degrees and the ball at 356, the offset is -6 — never +354 —
// so the english is -7.2 degrees. A build that subtracts raw angles reads
// ~354, rotates by ~425, and (after the clamp) leaves ~65 degrees on the
// other side of the radial: far outside this check's tolerance.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate(). The approach is
// purely radial down the 356-degree radial, so the offset every conformant
// build reads is exactly -6 and TOL_RADIAL_DEG is all the slack given.

import { afterEach, beforeEach, it } from "vitest";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  assertAngleClose,
  ballHeadingDeg,
  ENGLISH_PER_OFFSET,
  poseRadialApproach,
  soleBall,
  TOL_RADIAL_DEG,
} from "./pose";

/** The deflector's center angle: just past the 0/360 seam. */
const PADDLE_DEG = 2;
/** The ball's offset: just short of the seam, -6 wrap-aware from the center. */
const OFFSET_DEG = -6;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("computes the seam-straddling offset wrap-aware, in [-180, 180)", async () => {
  const pose = await poseRadialApproach(h, PADDLE_DEG, OFFSET_DEG);

  const after = await captureReplay(h, "bounce", async () => {
    const bounced = await h.tick(pose.ticks);
    await h.tick(8); // let the replay show the ball flying back out
    return bounced;
  });

  assertAngleClose(
    ballHeadingDeg(soleBall(after)),
    pose.thetaDeg + ENGLISH_PER_OFFSET * OFFSET_DEG,
    TOL_RADIAL_DEG,
    "the outgoing heading under the small signed offset, -6",
  );
});
