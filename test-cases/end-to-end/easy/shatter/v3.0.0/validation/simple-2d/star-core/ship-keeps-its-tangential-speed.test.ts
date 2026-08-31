// star-core/ship-keeps-its-tangential-speed — the slide keeps the motion along
// the surface.
//
// `specs/collision.md` step 2 of the slide is one sentence with two halves: "The
// component of the ship's velocity heading into the core is removed, and the
// component ALONG THE SURFACE is kept unchanged." This item is the second half.
// The first half is `star-core/ship-loses-its-inward-speed`, and the two are
// separate items on purpose: a build that zeroes the whole velocity on contact
// fails this one and passes that one, and a build that reflects the velocity off
// the core passes this one and fails that one, so a failed grade names which wrong
// model the build implemented.
//
// THE APPROACH IS OFF-CENTRE, on a line passing `20` units from the star's centre,
// which meets the `44`-unit surface `27` degrees off head-on. That leaves a
// tangential component a little under half the approach speed — some `165` units
// per second — so the five per cent this item allows is a bound of about eight
// units per second, and both wrong models above miss it by an order of magnitude.
// A head-on strike would have had nothing along the surface to keep and would have
// graded this rule vacuously.
//
// WHAT "ALONG THE SURFACE" MEANS IS TAKEN FROM THE CONTACT ITSELF: the normal is
// the direction from the star's centre out to the ship where the contact fell, and
// the tangent is a quarter-turn from it. Both readings — the tick before and the
// tick of the contact — are projected onto that same tangent, so what is compared
// is one number before and after and not two numbers in two frames.
//
// THE COMPARISON IS SIGNED. A build that kept the magnitude of the surface motion
// and reversed its direction has not kept it unchanged, and an unsigned reading
// would have called that conformant.
//
// WHAT THE FIVE PER CENT HAS TO ABSORB. `specs/simulation.md` orders the tick so
// that the velocity — drag included — is settled before collision resolves, so the
// figure the contact keeps is the one drag had already taken its tick off:
// `specs/ship.md`'s half-life of `3` seconds costs two parts in a thousand over one
// tick. The item's tolerance is twenty-five times that.

import { afterEach, beforeEach, it } from "vitest";
import { assertLessThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  IMPACT_OFFSET,
  contactOf,
  driveIntoTheCore,
  outwardNormal,
  poseGrazingApproach,
  tangentialSpeed,
} from "./strike";

/**
 * How long the ship is driven: three quarters of a second.
 *
 * The run-in is a third of a second at `APPROACH_SPEED`, so the contact falls
 * comfortably inside the drive with room for a build that resolves it a tick or
 * two later than the reference does.
 */
const DRIVE_TICKS = ticksFor(0.75);

/**
 * How far the surface motion may move across the contact: five per cent of itself.
 *
 * The review item's own figure, read as a fraction of the component the ship
 * carried in. `specs/collision.md` keeps it "unchanged", so the specification's
 * answer is zero change; five per cent is the room the item allows a build for
 * ordering its tick differently, and it is twenty-five times the two parts in a
 * thousand `specs/ship.md`'s drag takes off over the tick the contact falls in.
 */
const TANGENTIAL_TOLERANCE = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("carries the motion along the surface through the contact unchanged", async () => {
  startPlaying(h);
  poseGrazingApproach(h);

  const drive = await driveIntoTheCore(h, DRIVE_TICKS);
  const contact = contactOf(drive);
  captureStill(h, "slide");

  const surface = outwardNormal(contact.at.ship);
  const before = tangentialSpeed(contact.before.ship, surface);
  const after = tangentialSpeed(contact.at.ship, surface);

  assertLessThanOrEqual(
    Math.abs(after - before) / Math.abs(before),
    TANGENTIAL_TOLERANCE,
    `the share of its motion along the core's surface the ship lost across ` +
      `the contact, striking on a line passing ${IMPACT_OFFSET} units from ` +
      `the star's centre with ${before.toFixed(1)} units per second along it ` +
      `and ${after.toFixed(1)} after (specs/collision.md: the component along ` +
      "the surface is kept unchanged)",
  );
});
