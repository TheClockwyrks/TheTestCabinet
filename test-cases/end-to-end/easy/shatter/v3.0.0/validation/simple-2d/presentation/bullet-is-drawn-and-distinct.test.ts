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
// asserted: `specs/overview.md` leaves the palette to the build, so the
// requirement is that a round is painted something the field is not.
//
// THE ROUND IS POSED AT REST, and that is the isolation this item wants. A round
// standing still has no recent path, so a build's tail is not drawn and cannot be
// mistaken for the round: a build whose round is invisible and whose tail is
// bright would otherwise pass an item the tail has nothing to do with. `addBullet`
// places a round at whatever velocity it is asked for (`specs/instrumentation.md`),
// and `BULLET_SPOT` is `453` from the star, where the well moves a round at rest
// by a five-hundredth of a unit over the one tick this runs.
//
// THE POSE. An emptied, gated field with the ship parked in the far upper corner,
// `577` from the round, so the one body no scenario can remove is nowhere near the
// reading, and no rock, saucer or halo reaches the disc either.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R } from "../constants";
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
 * The sensing floor: how far a sample must sit from the field the build drew
 * before the reading can be called the build's own ink, of the 441 an RGB distance
 * can span.
 *
 * Eight. Below that a sampling cannot tell a drawing from the rounding of an 8-bit
 * channel and the host's own anti-aliasing; above it nothing is decided about how
 * strongly the mark reads. Anything the build painted over the sample clears it,
 * in whatever colour it chose, over whatever field it chose.
 */
const SENSING_FLOOR = 8;

/**
 * How many of the {@link DISC_SAMPLES} readings inside `BULLET_R` must be the
 * round's.
 *
 * The samples oversample a disc three units across, so the count is very nearly
 * the painted fraction of it times {@link DISC_SAMPLES}. `specs/weapons.md` calls
 * the gun's ammunition "small round bullets" and gives them a collision radius of
 * `3`, but fixes no drawn size. A round drawn as a single unit of ink at the
 * centre covers about a thirtieth of that disc, which is fifteen of these
 * samples; the bar sits just under that, a round drawn as the specification sizes
 * it marks nearly all of them, and a build that drew nothing there scores zero.
 */
const MIN_MARKED = 12;

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
    markedCount(round, field, SENSING_FLOOR),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside BULLET_R of a round posed at rest, how ` +
      `many are more than ${SENSING_FLOOR} of 441 from the field the build drew ` +
      "(specs/overview.md)",
  );
});
