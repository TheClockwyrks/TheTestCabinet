// presentation/bullet-is-drawn-and-distinct — a round reads apart from the field.
//
// THE RULE. `specs/overview.md`: "A bullet reads apart from the field, and each
// moving bullet leaves a continuous fading tail along its recent path." This item
// owns the FIRST half of that sentence and nothing else; the tail belongs to the
// `bullets` group, which grades its continuity, its taper and its length. A player
// who cannot see a round cannot tell a shot that missed from one never fired.
//
// WHAT IS READ. The disc of `BULLET_R` (`3`, `specs/weapons.md`) about the round's
// centre — `specs/overview.md` makes an entity's position its centre — against the
// field the build itself drew at points where nothing is posed. No colour is
// asserted: `specs/overview.md` leaves the palette to the build, so the requirement
// is that a round is painted something the field is not.
//
// THE ROUND IS POSED AT REST, and that is the isolation this item wants. A round
// standing still has no recent path, so a build's tail is not drawn and cannot be
// mistaken for the round: a build whose round is invisible and whose tail is bright
// would otherwise pass an item the tail has nothing to do with. `addBullet` places a
// round at whatever velocity it is asked for (`specs/instrumentation.md`), and
// `BULLET_SPOT` is `453` from the star, where the well moves a round at rest by a
// five-hundredth of a unit over the one frame this runs.
//
// THE POSE. An emptied, gated field with the ship parked in the far upper corner,
// `577` from the round, so the one body no scenario can remove is nowhere near the
// reading, and no rock, saucer or halo reaches the disc either.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R } from "../../src/constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseBullet,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc, readPainted } from "./ink";
import { BULLET_SPOT, FAR_SHIP, sampleField } from "./scene";

/**
 * How far a sample must be from the field to count as the round, of the 441 an RGB
 * distance can span.
 *
 * The item's own figure, and the same one every other body in this group is read
 * apart from its background by. Far above what a build's own dithering or a faint
 * vignette moves a background sample by, and far below the separation any two
 * colours a build would pick for a field and a round sit at.
 */
const APART = 60;

/**
 * How much of the disc of `BULLET_R` must be painted something other than the field.
 *
 * A quarter. `specs/weapons.md` calls the gun's ammunition "small round bullets" and
 * gives them a collision radius of `3`, but fixes no drawn size, so a build that
 * draws its round a little inside the circle it collides as is conformant: a round
 * mark of half the collision radius still covers a quarter of the disc. A build that
 * drew nothing there covers none of it.
 */
const MIN_FRACTION = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the disc of BULLET_R about a posed round apart from the field", async () => {
  startPlaying(h);
  h.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  poseBullet(h, BULLET_SPOT.x, BULLET_SPOT.y, 0, 0);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  const round = readDisc(painted, BULLET_SPOT, BULLET_R);
  captureStill(h, "bullet");

  assertGreaterThanOrEqual(
    markedCount(round, field, APART),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${String(DISC_SAMPLES)} samples inside BULLET_R of a round posed at ` +
      `rest, how many are more than ${String(APART)} of 441 from the field ` +
      "the build drew (specs/overview.md)",
  );
});
