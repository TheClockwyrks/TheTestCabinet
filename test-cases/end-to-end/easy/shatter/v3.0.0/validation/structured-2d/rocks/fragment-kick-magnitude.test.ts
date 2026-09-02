// rocks/fragment-kick-magnitude — the fan opens at SPLIT_KICK.
//
// `specs/collision.md` fixes the size of a gun kill's fan: each fragment takes "a
// kick of `SPLIT_KICK` (`90`) perpendicular to the bullet's travel at the moment it
// landed, the two fragments kicked to opposite sides". This item decides that
// figure alone — how fast the two halves leave each other — and it is what tells a
// rock coming apart from a rock quietly duplicating itself.
//
// IT IS READ OFF THE PAIR, WHICH IS WHAT REMOVES THE PARENT AND THE WELL FROM THE
// FIGURE. Each fragment is the parent's velocity plus a kick, the two kicked to
// opposite sides, so the DIFFERENCE between the two velocities is `2 x SPLIT_KICK`
// and the parent's own motion — including every unit per second `specs/gravity.md`
// added to it while the rock was being shot at — cancels exactly. Half that
// difference is the kick one fragment took. Reading a single fragment against the
// figure the scenario posed would instead measure the parent's drift, the well's
// work on it, and the kick, all at once.
//
// THE PLACEMENT IS `FRAGMENT_FAN` (`fixtures.ts`), the same arrangement the two
// direction items pose, so all three read the same event: a Large 412 units out
// from the star, drifting at a legal 85 units per second, taken by a round fired
// along `+x`. Under `warhead` that is three rounds rather than one, and the
// reading is taken on the tick the last of them landed.
//
// WHAT THIS DOES NOT DECIDE. Which way the fan points, which is
// `rocks/fragment-kick-is-perpendicular-to-the-shot`'s; that the two fragments go
// opposite ways at all, which is `rocks/fragment-kick-opposite-sides`'s; and the
// torpedo's much harder `TORPEDO_SCATTER`, which is `detonation/harder-scatter`'s.

import { afterEach, beforeEach, it } from "vitest";
import { SPLIT_KICK } from "../constants";
import { assertLessThanOrEqual } from "../assert";
import { FRAGMENT_FAN } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  destroyByGun,
  fragmentPair,
  lengthOf,
  roundAlong,
  velocityDifference,
} from "./scenario";

/**
 * How far half the pair's difference may sit from `SPLIT_KICK`: a tenth of it, as
 * the review item states.
 *
 * Room for a build's own arithmetic and for the order it applies a tick's motion
 * in, NOT for the environment — the parent's motion and the well's work on it
 * cancel in the difference of the pair. Nine units per second either side of 90,
 * against wrong models that read 0 (fragments that inherit the parent alone) or 240
 * (a build that gave the gun the torpedo's `TORPEDO_SCATTER`).
 */
const TOLERANCE = 0.1;

/** Ticks of the fragments opening apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.5);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("throws each fragment at SPLIT_KICK away from the parent's own motion", async () => {
  startPlaying(h);
  const parentId = poseRock(
    h,
    "large",
    FRAGMENT_FAN.parent.x,
    FRAGMENT_FAN.parent.y,
    FRAGMENT_FAN.drift.vx,
    FRAGMENT_FAN.drift.vy,
  );

  const kill = await destroyByGun(h, parentId, (target) =>
    roundAlong(target, FRAGMENT_FAN.shotHeading, { carry: false }),
  );

  const [first, second] = fragmentPair(
    kill.at,
    "medium",
    "fragment-kick-magnitude",
  );
  const kick = lengthOf(velocityDifference(first, second)) / 2;

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "fan");

  assertLessThanOrEqual(
    Math.abs(kick - SPLIT_KICK),
    SPLIT_KICK * TOLERANCE,
    `units per second between the kick each fragment took — half the ` +
      "difference of the pair's velocities — and SPLIT_KICK " +
      `(${SPLIT_KICK}), within a tenth (specs/collision.md)`,
  );
});
