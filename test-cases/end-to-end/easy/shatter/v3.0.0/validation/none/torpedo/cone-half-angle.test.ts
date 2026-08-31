// torpedo/cone-half-angle — the cone reaches 15 degrees off the heading, and no
// further.
//
// specs/weapons.md, "The guidance": a body is a candidate when "its bearing from
// the torpedo lies within `TORPEDO_CONE` (`15` degrees) of the torpedo's current
// heading, on either side". This is the item that decides where that edge is, and
// it reads it from both directions: a rock `14` degrees off is taken, a rock `16`
// degrees off is not.
//
// THE TWO ROCKS SIT ON OPPOSITE SIDES OF THE HEADING, which is what "on either
// side" means and what a build with a signed test rather than a magnitude one gets
// wrong. The one inside the cone is posed clockwise of the heading and the one
// outside anticlockwise, so a build whose cone opens to one side alone fails one of
// the two readings whichever side it favours.
//
// EACH ROCK IS 250 UNITS AHEAD, AND THE GEOMETRY DOES THE REST. At that range a
// rock `16` degrees off the line stands `69` units across it — three times the `20`
// at which a torpedo and a Small touch (specs/collision.md) — so a torpedo that
// never acquires it flies past untouched, and only one that turned could reach it.
// A rock `14` degrees off stands `60` units across, so the kill in the first half
// cannot happen without a turn either: the torpedo has to come round onto it, which
// is exactly what "acquired" means.
//
// SMALLS, SO THE ROSTER READS CLEANLY. specs/rocks.md leaves nothing behind when a
// Small is destroyed, so "the rock is gone" and "the rock survived" are each one
// reading of the roster rather than a count of fragments.
//
// THE TWO HALVES ARE FLOWN SEPARATELY. Both rocks on the field at once would put
// the refused one inside the cone the moment the torpedo turned onto the other, so
// the field and the roster are emptied between them and each half is posed from the
// same point on the same heading.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual, assertTrue, assertUndefined } from "../assert";
import { DEG, TORPEDO_CONE_DEG } from "../constants";
import { angleBetween } from "../geometry";
import {
  captureStill,
  createHarness,
  poseRock,
  poseTorpedo,
  rockById,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { COLUMN, flyTorpedo, HEADING_DOWN, pointAt } from "./scene";

/** A degree inside the cone's half-angle, clockwise of the heading. */
const INSIDE_DEG = TORPEDO_CONE_DEG - 1;

/** A degree outside it, anticlockwise, so both sides of the cone are read. */
const OUTSIDE_DEG = -(TORPEDO_CONE_DEG + 1);

/** How far ahead each rock is posed, in units. */
const RANGE = 250;

/** How long the taken rock is given to be destroyed, in ticks. */
const KILL_TICKS = ticksFor(1.2);

/** How long the refused rock is flown past, in ticks: past its whole range. */
const PASS_TICKS = ticksFor(1);

/**
 * How far the heading may turn while passing the refused rock, in radians.
 *
 * One degree, the short way round. A torpedo with no candidate "flies straight on
 * its current heading" (specs/weapons.md); a build whose cone reached `16` degrees
 * would turn the whole `16` toward it.
 */
const HEADING_TOLERANCE = 1 * DEG;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes a rock 14 degrees off its heading and never turns onto one 16 degrees off", async () => {
  await startPlaying(h);

  // Inside the cone: posed across the torpedo's line by more than the pair's
  // radii, so only a turn can reach it.
  const takenAt = pointAt(COLUMN, HEADING_DOWN + INSIDE_DEG * DEG, RANGE);
  const taken = await poseRock(h, "small", takenAt.x, takenAt.y);
  await poseTorpedo(h, COLUMN.x, COLUMN.y, HEADING_DOWN);

  await h.until((snapshot) => rockById(snapshot, taken) === undefined, {
    maxTicks: KILL_TICKS,
    poll: 1,
  });
  const struck = await h.snapshot();
  // The rock just inside the cone, taken.
  await captureStill(h, "cone");

  assertUndefined(
    rockById(struck, taken),
    `the rock ${INSIDE_DEG} degrees off the torpedo's heading and ${RANGE} ` +
      `units ahead — ${(RANGE * Math.sin(INSIDE_DEG * DEG)).toFixed(0)} units ` +
      `across its line, so nothing but a turn onto it could reach it — ` +
      `destroyed within ${KILL_TICKS} ticks (specs/weapons.md: a body inside ` +
      `TORPEDO_CONE (${TORPEDO_CONE_DEG} degrees) of the heading is a candidate)`,
  );

  // Outside it, on the other side: the same pose, the same range, two degrees
  // further off the line.
  await h.debug.clearTorpedoes();
  await h.debug.clearRocks();
  const missedAt = pointAt(COLUMN, HEADING_DOWN + OUTSIDE_DEG * DEG, RANGE);
  const missed = await poseRock(h, "small", missedAt.x, missedAt.y);
  const outside = await poseTorpedo(h, COLUMN.x, COLUMN.y, HEADING_DOWN);

  const flight = await flyTorpedo(h, outside, PASS_TICKS);
  const passed = await h.snapshot();

  const turned = flight.headings.reduce(
    (most, heading) => Math.max(most, angleBetween(heading, HEADING_DOWN)),
    0,
  );
  assertLessThanOrEqual(
    turned,
    HEADING_TOLERANCE,
    `the radians the torpedo's heading turned while passing a rock ` +
      `${Math.abs(OUTSIDE_DEG)} degrees off it — a degree outside the ` +
      `TORPEDO_CONE (${TORPEDO_CONE_DEG} degrees) half-angle specs/weapons.md ` +
      `fixes, and on the opposite side from the rock it took; ` +
      `${(turned / DEG).toFixed(3)} degrees`,
  );
  assertTrue(
    rockById(passed, missed) !== undefined,
    `the rock ${Math.abs(OUTSIDE_DEG)} degrees off the heading still standing ` +
      `after the torpedo flew past it (specs/weapons.md: it is outside the ` +
      `cone, so it is never a candidate)`,
  );
});
