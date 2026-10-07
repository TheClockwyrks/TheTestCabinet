// effects/multiball-parked-stays — a multiball catch leaves a parked ball
// parked: it neither launches with the pair nor is removed.
//
// specs/pods.md: "a parked ball stays parked". A parked ball "sits at radius
// `194` at the deflector's center angle" (specs/deflector-and-ball.md), so
// after the catch the world holds the parked ball plus the launched pair,
// exactly one ball still reports parked, and it still sits on the deflector;
// its posed resting figures are read to float precision, off any contact
// boundary.
//
// THE WORLD IS ONE PARKED BALL AND ONE POD. The cap (6) admits both launches
// beside the parked ball, so the count separates "stays parked" from
// "launched with the pair" (no parked ball) and from "removed" (two balls).

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import {
  close,
  dropPod,
  LAUNCH_RADIUS,
  offset,
  open,
  park,
  polar,
  record,
  snap,
  START_ANGLE,
  world,
  type Harness,
} from "./pose";

let h: Harness;

beforeEach(async () => {
  h = await open();
});

afterEach(async () => {
  await close(h);
});

it("keeps the parked ball parked through the catch", async () => {
  await world(h);
  await park(h);
  const posed = await snap(h);
  assertLength(posed.balls, 1, "the one posed ball");
  assertEqual(posed.balls[0].parked, true, "posed parked");

  const after = await record(h, "multiball-parked", () =>
    dropPod(h, "multiball"),
  );

  assertLength(after.pods, 0, "the pod after the catch tick");
  assertLength(after.balls, 3, "the parked ball plus the launched pair");
  const parked = after.balls.filter((ball) => ball.parked);
  assertLength(parked, 1, "exactly the one parked ball stays parked");
  const p = polar(parked[0]);
  assertCloseTo(p.r, LAUNCH_RADIUS, 3, "still at the serve radius");
  assertCloseTo(
    offset(START_ANGLE, p.theta),
    0,
    3,
    "still at the deflector's center angle",
  );
});
