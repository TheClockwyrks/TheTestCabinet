// star-core/ship-slides-along-the-core — the ship is put back on the surface.
//
// `specs/collision.md` writes the slide in three numbered steps, and this item is
// step 1: "The ship's centre is pushed back out along the direction from the star's
// centre to the ship, to a distance of `CORE_R + SHIP_R` (`44`) from `(STAR_X,
// STAR_Y)`." `specs/field.md` says why there is a step at all — the core is the one
// physical boundary on the field, solid, and the ship slides along it. The velocity
// the contact leaves behind is the two items beside this one; this is the position
// alone.
//
// TWO READINGS, BOTH OF THE ONE REQUIREMENT, because either alone can be satisfied
// by a build that is not doing what step 1 says.
//
// - WHERE THE CONTACT LEFT THE SHIP. On the tick the contact fell in, the ship's
//   centre is `44` from the star's. A build that pushed it out to `50`, or stopped
//   it at `60`, fails here — and a check that had read only how near the ship ever
//   came would have missed it, because the sample before the contact is a couple of
//   units outside the surface whatever the build then does with it.
// - AND HOW NEAR IT EVER CAME. Over the whole drive the ship's centre never reads
//   inside `44`, because the core is solid. A build with no ship-and-core rule at
//   all fails here — its centre reaches the `20` units its line was laid at — and a
//   check that had read only where the contact left it would have missed that one,
//   because the first tick of a ship sailing INTO the core is a tick that reads
//   close to the surface too.
//
// THE APPROACH IS OFF-CENTRE, passing `20` units from the star's centre, because
// the sibling items read the velocity split off this same contact and a head-on
// strike has nothing along the surface to keep. The ship is driven with no key
// held, so `specs/ship.md`'s rotation and thrust never run and drag is the only
// force on it besides the contact; `specs/gravity.md` never pulls the ship.
//
// THE CLIP DOES NOT CUT ON THE MEASUREMENT. The drive runs half a second past the
// contact, so the recording shows the ship graze the core and slide free — the
// outcome the item is named for — rather than ending on the frame the reading was
// taken on.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLessThanOrEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import {
  IMPACT_OFFSET,
  SURFACE,
  contactOf,
  distanceFromStar,
  driveIntoTheCore,
  poseGrazingApproach,
} from "./strike";

/**
 * How long the ship is driven: one and a fifth seconds.
 *
 * The run-in is a third of a second at `APPROACH_SPEED`, so the rest is the slide
 * away from the core — enough for the recording to show the outcome, and short
 * enough that the ship never travels far enough to wrap and come back at the star
 * a second time.
 */
const DRIVE_TICKS = ticksFor(1.2);

/**
 * How far off `CORE_R + SHIP_R` either reading may fall: one unit.
 *
 * The review item's own figure, and rounding room rather than an allowance: the
 * specification's answer is exactly `44`. A build that let the ship through reads
 * {@link IMPACT_OFFSET}, `24` units under the figure, which this catches
 * twenty-four times over.
 */
const SURFACE_TOLERANCE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the ship's centre standing on the core's surface, and never inside it", async () => {
  startPlaying(h);
  poseGrazingApproach(h);

  const drive = await captureReplay(h, "slide", () =>
    driveIntoTheCore(h, DRIVE_TICKS),
  );
  const resting = distanceFromStar(contactOf(drive).at.ship);

  assertLessThanOrEqual(
    Math.abs(resting - SURFACE),
    SURFACE_TOLERANCE,
    `units between ${SURFACE} and where the contact left the ship's centre, ` +
      `driven at the core on a line passing ${IMPACT_OFFSET} units from the ` +
      "star's centre (specs/collision.md: the ship's centre is pushed back " +
      "out to CORE_R + SHIP_R from the star's centre)",
  );
  assertGreaterThanOrEqual(
    drive.closest,
    SURFACE - SURFACE_TOLERANCE,
    "units of the nearest the ship's centre came to the star's centre over " +
      "the whole drive (specs/field.md: the core is the one physical " +
      "boundary on the field, and the ship slides along it)",
  );
});
