// rocks/fragment-velocity-carries-the-parent — a split hands its own motion on.
//
// `specs/collision.md`: "Each fragment's velocity is the destroyed rock's velocity
// on the tick it was destroyed, plus a kick". This item decides the FIRST half of
// that sentence and nothing else: whatever the kick did, the two fragments between
// them carry the parent's motion away with them, so a Large drifting across the
// field does not leave two fragments hanging where it died.
//
// IT IS READ OFF THE PAIR, WHICH IS WHAT MAKES IT A READING OF THE PARENT. The two
// fragments take the parent's velocity plus equal and opposite kicks, so their
// AVERAGE is the parent's velocity exactly and the kick falls out of the arithmetic
// altogether. Reading one fragment on its own would be reading the parent plus a
// kick of 90 units per second and could not decide anything within 10.
//
// THE PARENT IS READ FROM THE SNAPSHOT, NEVER FROM THE FIGURE THE SCENARIO POSED.
// `specs/gravity.md`'s well is acting on the rock the whole time it is being shot
// at, so by the time it breaks its velocity is not the `(-60, -60)` it was given.
// The comparison is against its velocity on the tick BEFORE the fatal round landed,
// which is what `specs/collision.md` names, so nothing the well did enters the
// figure. That is fold-in fix C of `changelog.md`: the previous version of this
// case posed its parent where the well had moved that velocity substantially over
// the shots, and the item then read a drift gravity had built rather than the one
// it arranged.
//
// THE PLACEMENT IS `FRAGMENT_FAN` (`fixtures.ts`): the parent at (320, 620), 412
// units from the star where the well pulls at some 26 units per second squared, so
// over the tick between the reading and the kill it adds a fifth of a unit per
// second — a fiftieth of the bound below. Its diagonal drift against a horizontal
// shot is the OTHER item's business (`rocks/fragment-kick-is-perpendicular-to-the-
// shot`), and it costs this one nothing: a drift of 85 units per second is what
// makes "carries the parent" a claim at all, since a parent at rest would be
// satisfied by a build that gives its fragments no inherited motion whatsoever.
//
// WHAT THIS DOES NOT DECIDE. The kick — its direction, its size, or that the two
// fragments take opposite sides of it — which are the three `rocks/fragment-kick-*`
// items, and each of which this reading is deliberately blind to.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import { FRAGMENT_FAN } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  destroyByGun,
  fragmentPair,
  lengthOf,
  meanVelocity,
  roundAlong,
} from "./scenario";

/**
 * How far the average of the two fragments' velocities may lie from the parent's,
 * in units per second, as the review item states: ten.
 *
 * Room for a build's own arithmetic and for the order it applies a tick's motion
 * in, NOT for the environment. The well's contribution between the reading and the
 * kill is about a fifth of a unit per second at this placement, and the kick — 90
 * units per second on each fragment — cancels exactly in the average. The wrong
 * model this bound is set against is a build whose fragments start from rest, which
 * reads the parent's whole 85 units per second.
 */
const TOLERANCE = 10;

/** Ticks of the fragments coming apart, run after the reading is taken. */
const AFTERMATH_TICKS = ticksFor(0.35);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("gives the two fragments an average velocity equal to the parent's", async () => {
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

  const parent = requireRock(
    kill.before,
    parentId,
    "the Large on the tick before the fatal round landed",
  );
  const [first, second] = fragmentPair(
    kill.at,
    "medium",
    "fragment-velocity-carries-the-parent",
  );

  await h.advance(AFTERMATH_TICKS);
  captureStill(h, "fan");

  const average = meanVelocity(first, second);
  const drift = lengthOf({
    x: average.x - parent.vx,
    y: average.y - parent.vy,
  });

  assertLessThanOrEqual(
    drift,
    TOLERANCE,
    "units per second between the average of the two fragments' velocities " +
      `and the parent's (${parent.vx.toFixed(1)}, ${parent.vy.toFixed(1)}) on ` +
      "the tick before it broke — each fragment takes the destroyed rock's " +
      "velocity plus a kick, and the two kicks cancel in the average " +
      "(specs/collision.md)",
  );
});
