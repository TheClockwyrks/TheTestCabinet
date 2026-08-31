// presentation/bullet-is-drawn-and-distinct — a round reads apart from the field.
//
// THE RULE. `specs/overview.md`: "A bullet reads apart from the field, and each
// moving bullet leaves a continuous fading tail along its recent path." The tail is
// `bullets/trail-drawn`'s to grade; what is here is the round itself.
//
// WHAT IS READ. The disc of `BULLET_R` (`3`, `specs/weapons.md`) about the round's
// centre, against the field the build drew, exactly as the ship and the rock are
// read. Three units is a small mark, so the bar is small too: the question the item
// asks is whether the round is on the canvas at all, and a build that drew nothing
// there scores zero however the bar is set.
//
// THE ROUND IS POSED AT REST, and that is the isolation this item wants. A bullet is
// only required to draw a TAIL while it is moving, and a tail is drawn along the
// path behind it — so a round with a velocity would paint the disc being read with
// its own trail and the reading would be of the tail rather than of the round. At
// rest there is no recent path, so what is inside `BULLET_R` is the round.
//
// AND WHY IT IS POSED FAR OUT. `BULLET_SPOT` is `453` from the star's centre, where
// the well pulls at about `22` units per second squared, so over the one tick this
// reading takes the round moves well under a hundredth of a unit — and the position
// is re-read from the build's own snapshot before the disc is laid on it in any
// case, so the samples follow the round rather than the place it was posed.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { BULLET_R } from "../constants";
import {
  captureStill,
  createHarness,
  poseBullet,
  requireBullet,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc } from "./ink";
import { BULLET_SPOT, FAR_SHIP } from "./scene";

/** How far a sample must be from the field to be the round's, of 441. The item's figure. */
const APART = 60;

/**
 * How many of the {@link DISC_SAMPLES} readings inside `BULLET_R` must be the round's.
 *
 * The samples oversample a disc three units across, so the count is very nearly the
 * painted fraction of it times {@link DISC_SAMPLES}. A round drawn as a single unit
 * of ink at the centre covers about a thirtieth of that disc, which is fifteen of
 * these samples; the bar sits just under that, and a round drawn as the specification
 * sizes it marks nearly all of them.
 */
const MIN_MARKED = 12;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("paints the disc of BULLET_R about a posed round apart from the field", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  const id = await poseBullet(harness, BULLET_SPOT.x, BULLET_SPOT.y, 0, 0);
  await harness.advance(1);

  const round = requireBullet(await harness.snapshot(), id, "the posed round");
  const field = await sampleField(harness);
  const look = await readDisc(harness, round, BULLET_R);
  await captureStill(harness, "bullet");

  assertGreaterThanOrEqual(
    markedCount(look, field, APART),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside BULLET_R of the round's centre, how many are more than ${APART} of 441 from the field the build drew (specs/overview.md)`,
  );
});
