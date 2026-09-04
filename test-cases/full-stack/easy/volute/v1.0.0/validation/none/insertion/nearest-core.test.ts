// insertion/nearest-core — the nearest of several candidates is the one struck.
//
// THE SPEC LINE. `specs/injector.md`, "Striking a core": "A core qualifies when
// the distance between its center and the projectile's center is at most the
// strike distance of 28 units. The core with the smallest center distance is
// struck". So when two cores are both inside the window on the same tick, the
// nearer one is the one the insertion is measured from.
//
// WHY THE PAIR IS NOT ONE SPACING APART. Two cores exactly `SPACING` apart give
// the SAME answer whichever of them is struck: a shot arriving between them
// enters ahead of the rear one (`p = c.s`) and behind the front one
// (`p = c.s - SPACING`), and those are the same arc position. So a pair posed at
// the channel's own spacing cannot decide this point at all. The pair is posed
// `PAIR_GAP` (42 units) apart instead, one and a half spacings, which puts the
// two candidate answers 14 units apart while keeping both cores inside the
// 28-unit window from one point on the shot's path.
//
// A 42-unit pair is TWO segments, because "A **segment** is a maximal run of
// consecutive cores in the train whose arc positions differ by exactly `SPACING`"
// (specs/channel.md). So the front core is the lead segment and rides the feed
// while the rear closes at the fixed catch-up rate of 180 units/s, and the pose
// allows for both: each core is placed one tick of ITS OWN rate short of where it
// must stand when the strike resolves (specs/channel.md, "The order of a tick" —
// segments advance at step 2, projectiles strike at step 3).
//
// HOW THE ANSWER IS READ. Not against a predicted arc position, which would make
// the check depend on the flight arithmetic as much as on the rule, but against
// the train the insertion left. Striking the REAR core seats at that core's own
// arc position and shifts it back one spacing, leaving the seated core exactly
// `SPACING` ahead of it and `PAIR_GAP` behind the front core. Striking the FRONT
// core instead seats one spacing behind IT, which is `PAIR_GAP - SPACING` = 14
// units further along, leaving those two gaps swapped. The two readings are
// therefore 28 against 42 on one side and 42 against 28 on the other, and the
// seated core is identified by the charge the shot was fired with, which no core
// on the channel shares.
//
// THE TOLERANCES.
//
// The gaps are compared within `ARC_TOL` (0.5 units, the case's standing
// tolerance on an arc position). They are arithmetic on the positions of the tick
// the insertion resolved on rather than an integration, so half a unit is
// generous, and the two answers are 14 units apart — 28 tolerances — so nothing
// can be mistaken for the other.
//
// The arrangement's own margin is the gap between the two centre distances: 18
// units to the rear core and 24 to the front, both inside the 28-unit window and
// 6 units apart. That 6 is what a build's flight has to be wrong by before the
// wrong core is the nearer one, against a tick that carries the projectile 10.33
// units ALONG its path and the train 0.37 or 3.0 units along the channel. A build
// sampling a whole tick early or late measures 20.9 and 25.9 — the same answer.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLessThan,
  assertNear,
  assertNotEqual,
} from "../assert";
import { ARC_TOL, SPACING, STRIKE_DISTANCE } from "../constants";
import {
  captureReplay,
  coreCount,
  coreWithCharge,
  createHarness,
  head,
  poseHall,
  tail,
  topRunS,
  type Harness,
} from "../harness";
import {
  approach,
  assertInFlight,
  PLUMB_SHOT_X,
  SHOT,
  STAGE,
  UP_AIM,
} from "./stage";

/** How far apart in arc the two candidate cores stand when the strike resolves. */
const PAIR_GAP = 42;

/** The centre distance from the shot's path to the NEARER (rear) core, in `x`. */
const NEAR_OFFSET = 18;

/** The centre distance to the FARTHER (front) core: the same pair, 42 units on. */
const FAR_OFFSET = PAIR_GAP - NEAR_OFFSET;

/** The two cores' charges. Neither is the shot's, so nothing can extract. */
const REAR = "halide";
const FRONT = "sulfur";

/** Ticks driven after the strike, so the replay shows the seated core riding on. */
const SETTLE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("strikes the nearer of two cores inside the window", async () => {
  // The arrangement, stated against the spec's own figures.
  assertLessThan(NEAR_OFFSET, FAR_OFFSET, "the rear core is the nearer one");
  assertLessThan(
    FAR_OFFSET,
    STRIKE_DISTANCE,
    "both cores are inside the window",
  );
  assertNotEqual(
    PAIR_GAP,
    SPACING,
    "a pair one spacing apart would seat in the same slot either way",
  );

  await poseHall(h, STAGE);

  const after = await captureReplay(h, "nearest", async () => {
    const short = await approach(h, UP_AIM);
    assertInFlight(short);
    // The rear core lands NEAR_OFFSET units to the -x side of the shot's path and
    // the front core FAR_OFFSET units to the +x side, so at the strike the rear
    // is 18 units away and the front 24. The rear rides the catch-up rate and the
    // front the feed, so each is posed one tick of its own rate short.
    const rearS = topRunS(PLUMB_SHOT_X - NEAR_OFFSET);
    await h.debug.poseTrain([
      [rearS + PAIR_GAP, FRONT, null],
      [rearS, REAR, null],
    ]);
    const struck = await h.step(1);
    await h.step(SETTLE);
    return struck;
  });

  assertEqual(coreCount(after), 3, "the shot seated into the train");

  const seated = coreWithCharge(after, SHOT);
  assertEqual(
    seated?.charge,
    SHOT,
    "a core carrying the fired charge stands on the channel",
  );
  assertNear(
    (seated?.s ?? NaN) - tail(after).s,
    SPACING,
    ARC_TOL,
    "the seated core stands one spacing ahead of the rear core, which is where " +
      "an insertion measured from the NEARER core leaves it " +
      "(specs/injector.md, Striking a core)",
  );
  assertNear(
    head(after).s - (seated?.s ?? NaN),
    PAIR_GAP,
    ARC_TOL,
    "and the front core, which was not struck, still stands the pair's own gap " +
      "ahead of it",
  );
});
