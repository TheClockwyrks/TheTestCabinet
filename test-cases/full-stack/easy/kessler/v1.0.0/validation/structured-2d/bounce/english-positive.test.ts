// bounce/english-positive — a +theta offset rotates the mirror by 1.2x the
// offset, toward +theta.
//
// specs/deflector-and-ball.md, "The deflector bounce", step 2: "English:
// rotate v' by 1.2 * offset degrees, where offset is the signed wrap-aware
// angular offset in degrees of the ball's center from the deflector's center
// angle, positive toward +theta." On a purely radial approach the specular
// mirror sends the ball straight back out its own radial, so the whole
// outgoing deviation from that radial IS the english: +10 degrees of offset
// must leave at exactly +12 degrees, well inside the 60-degree clamp.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate(). The approach is
// purely radial, so the ball's center angle — and with it the offset and n —
// never changes on the way in: every conformant reading agrees to float
// noise, and TOL_RADIAL_DEG is all the slack the check gives.

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

/** The deflector's center angle for the pose. */
const PADDLE_DEG = 90;
/** The ball's offset from the deflector's center, toward +theta. */
const OFFSET_DEG = 10;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("rotates the mirror by 1.2x a +theta offset, toward +theta", async () => {
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
    "the outgoing heading: the outward radial rotated by the english",
  );
});
