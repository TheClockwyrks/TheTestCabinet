// star-core/ship-loses-its-inward-speed — the slide takes the inward motion off.
//
// `specs/collision.md` step 2 of the slide is one sentence with two halves: "The
// component of the ship's velocity HEADING INTO THE CORE IS REMOVED, and the
// component along the surface is kept unchanged." This item is the first half, and
// `star-core/ship-keeps-its-tangential-speed` is the second.
//
// THE READING IS SIGNED, AND THAT IS THE WHOLE ITEM. The motion along the normal
// is measured positive OUTWARD, and the specification's answer after the contact is
// zero: the part heading in has been taken off, and nothing has been added going
// out. Three wrong models each read as a different number, so a failure names which
// one the build implemented:
//
// - it removed nothing, or resolved no contact at all: some `-360` units per
//   second, the whole inward run-in still there;
// - it reflected the velocity off the core, as a rock bouncing off a wall: some
//   `+360`, the same figure with the other sign;
// - it zeroed the whole velocity: `0` here, and this item passes — the build fails
//   the tangential item instead, which is the point of grading the two separately.
//
// AN UNSIGNED READING WOULD HAVE MISSED THE SECOND. "The component heading into the
// core" of a reflected velocity is nothing at all, so a check that asked only
// whether the ship was still heading inward would have called a bouncing core
// conformant. The rule is that the component along the normal is REMOVED, and a
// build that put motion back the other way did not remove it.
//
// THE APPROACH IS OFF-CENTRE, on a line passing `20` units from the star's centre,
// so the same contact serves this item and the tangential one and the two are read
// off one arrangement. It meets the `44`-unit surface `27` degrees off head-on,
// which leaves the inward component at some nine tenths of the approach speed:
// seventy-odd times the five units per second this item allows.
//
// WHERE THE NORMAL COMES FROM. The direction from the star's centre out to the ship
// where the contact fell, so the split is read against the surface the contact
// actually happened on rather than one the pose predicted.

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
  radialSpeed,
} from "./strike";

/** How long the ship is driven: three quarters of a second, as the sibling item. */
const DRIVE_TICKS = ticksFor(0.75);

/**
 * How much motion may be left along the normal, in units per second: five.
 *
 * The review item's own figure. `specs/collision.md` removes the component heading
 * into the core and adds nothing going out, so the specification's answer is
 * exactly zero and this is the room a build is allowed for ordering its tick
 * differently — under one and a half per cent of the `360`-odd units per second the
 * approach carries into the surface.
 */
const RADIAL_TOLERANCE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship no motion along the core's normal after the contact", async () => {
  startPlaying(h);
  poseGrazingApproach(h);

  const drive = await driveIntoTheCore(h, DRIVE_TICKS);
  const contact = contactOf(drive);
  captureStill(h, "slide");

  const surface = outwardNormal(contact.at.ship);
  const before = radialSpeed(contact.before.ship, surface);
  const after = radialSpeed(contact.at.ship, surface);

  assertLessThanOrEqual(
    Math.abs(after),
    RADIAL_TOLERANCE,
    "units per second the ship still carries along the core's normal after " +
      `the contact, signed outward — it came in at ${before.toFixed(1)} ` +
      `striking on a line passing ${IMPACT_OFFSET} units from the star's ` +
      "centre (specs/collision.md: the component of the ship's velocity " +
      "heading into the core is removed)",
  );
});
