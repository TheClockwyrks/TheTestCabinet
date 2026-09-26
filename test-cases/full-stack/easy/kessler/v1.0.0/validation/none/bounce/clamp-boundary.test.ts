// bounce/clamp-boundary — a rotated velocity at or under 60 degrees keeps its
// angle exactly, because the clamp is to [-60, +60] INCLUSIVE.
//
// specs/deflector-and-ball.md, "The deflector bounce", step 3: "The outgoing
// direction uses a clamped to [-60, +60] degrees, sign preserved" — a clamp,
// not a snap, so an angle inside the bound passes through untouched. The pose
// brings the ball in at +45 degrees from the inward radial with a +10-degree
// offset: the rotated velocity sits at 45 + 1.2 * 10 = +57 degrees from n,
// under the bound, and must leave at +57 — not pulled to 60, not pulled
// toward the radial, not cut off by a tighter bound.
//
// THE WORLD IS ONE BALL AND THE DEFLECTOR, per isolate(). TOL_ANGLED_DEG
// covers the tick-sized slack in where a build reads "the ball's center"; a
// build clamping at a tighter figure (45, say) is ~12 degrees out.

import { afterEach, beforeEach, it } from "vitest";
import { captureReplay, openHarness, type Harness } from "../harness";
import {
  assertAngleClose,
  ballHeadingDeg,
  ENGLISH_PER_OFFSET,
  poseAngledApproach,
  soleBall,
  TOL_ANGLED_DEG,
} from "./pose";

/** The deflector's center angle for the pose. */
const PADDLE_DEG = 90;
/** The ball's offset from the deflector's center, toward +theta. */
const OFFSET_DEG = 10;
/** The approach's signed angle from the inward radial, toward +theta. */
const BETA_DEG = 45;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("keeps a +57-degree rotated velocity at +57: under the bound, unclamped", async () => {
  const pose = await poseAngledApproach(h, PADDLE_DEG, OFFSET_DEG, BETA_DEG);

  const after = await captureReplay(h, "bounce", async () => {
    const bounced = await h.tick(pose.ticks);
    await h.tick(8); // let the replay show the ball flying back out
    return bounced;
  });

  assertAngleClose(
    ballHeadingDeg(soleBall(after)),
    pose.thetaDeg + BETA_DEG + ENGLISH_PER_OFFSET * OFFSET_DEG,
    TOL_ANGLED_DEG,
    "the outgoing heading, kept exactly where the english left it",
  );
});
