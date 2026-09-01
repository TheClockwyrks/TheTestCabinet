// presentation/torpedo-is-drawn-and-distinct — the torpedo reads apart from the
// field and apart from the rounds it flies beside. `warhead` only.
//
// THE RULE. `specs/overview.md`'s legibility table, under `warhead`: "The torpedo |
// The torpedo reads apart from the bullets at a glance, as the heavy weapon rather
// than a round." A torpedo a player cannot tell from a bullet is a weapon they
// cannot tell they have spent, on a ten-second recharge.
//
// WHAT IS READ. The disc of `TORPEDO_R` (`6`, `specs/collision.md`) about the
// torpedo's centre, and the disc of `BULLET_R` (`3`) about a round posed across the
// field from it, both against the field the build itself drew at points where
// nothing is posed. The two colours the build chose are then compared with each
// other. Nothing here asserts a palette or a silhouette: "as the heavy weapon rather
// than a round" is a reviewer's reading of the picture, and what a script can decide
// is that a torpedo is painted at all and that the two are told apart.
//
// WHY THE TWO BOUNDS DIFFER is the note in `rocks-are-drawn-and-distinct`: sixty of
// 441 separates a body from a field that is dark by requirement, forty separates two
// bodies a build drew to be seen against it. Both are the item's own figures.
//
// THE TORPEDO CANNOT BE POSED AT REST, because `addTorpedo` puts one in flight at
// `TORPEDO_SPEED` (`specs/instrumentation.md`) and no operation stops it. So its
// centre is re-read off the build's own snapshot before the disc is laid on it, and
// the samples follow the torpedo rather than the place it was posed. The field holds
// no rock and no saucer, so there is nothing for its guidance to turn onto in any
// case.
//
// AND THE ROUND IS POSED AT REST, for the reason `bullet-is-drawn-and-distinct`
// states: a round with a velocity paints a tail along the field it has crossed, and
// the reading would be of the path rather than of the round.

import { afterEach, beforeEach, it } from "vitest";
import { BULLET_R, TORPEDO_R } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import type { Vec } from "../geometry";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseBullet,
  startPlaying,
  torpedoById,
  torpedoesOf,
  type Harness,
  type Rgb,
} from "../harness";
import { requireOp } from "../surface";
import {
  DISC_SAMPLES,
  markedColor,
  markedCount,
  readDisc,
  readPainted,
} from "./ink";
import { BULLET_SPOT, FAR_SHIP, sampleField } from "./scene";

/** How far a sample must be from the field to be a body's, of 441. The item's figure. */
const APART_FROM_FIELD = 60;

/** How far the torpedo's colour must be from the round's, of 441. The item's figure. */
const APART_FROM_BULLET = 40;

/** The heading it is posed on: straight along `+x`, so its drawn body stays inside. */
const HEADING = 0;

/**
 * How much of the disc of `TORPEDO_R` must be painted something other than the
 * field.
 *
 * A quarter. `specs/collision.md` gives the torpedo a collision radius of `6` and
 * `specs/weapons.md` fixes no drawn size, so a build that draws its dart a little
 * inside the circle it collides as is conformant: a mark half the collision radius
 * across still covers a quarter of the disc. A build that drew nothing there covers
 * none of it.
 */
const MIN_FRACTION = 0.25;

/**
 * Where the torpedo is posed: low and to the right, `453` from the star's centre.
 *
 * The mirror of `BULLET_SPOT` across the field's column, so the two bodies compared
 * here stand `680` apart and neither is drawn anywhere near the other, and so the
 * well pulls on neither reading — a torpedo it never pulls at all
 * (`specs/gravity.md`), and a round at rest by under a hundredth of a unit over the
 * one frame this takes. Its whole drawn extent is `60` clear of the bottom seam.
 */
const TORPEDO_SPOT: Vec = { x: 980, y: 660 };

/** The colour a body was drawn in, or the failure that it was drawn in nothing. */
function inkOf(look: readonly Rgb[], field: Rgb, body: string): Rgb {
  const found = markedColor(look, field, APART_FROM_FIELD);
  if (found === null) {
    fail(
      `a colour the ${body} was drawn in, so the two bodies a player must ` +
        "tell apart can be compared (specs/overview.md)",
      `nothing inside the ${body} was drawn more than ` +
        `${String(APART_FROM_FIELD)} of 441 from the field`,
    );
  }
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the torpedo apart from the field and apart from a round", async () => {
  startPlaying(h);
  h.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  poseBullet(h, BULLET_SPOT.x, BULLET_SPOT.y, 0, 0);
  requireOp(h.debug, "addTorpedo")(TORPEDO_SPOT.x, TORPEDO_SPOT.y, HEADING);
  const posed = torpedoesOf(h.snapshot());
  if (posed.length === 0) {
    fail(
      "addTorpedo to append a torpedo to the roster " +
        "(specs/instrumentation.md)",
      "the torpedo roster is empty",
    );
  }
  const torpedoId = posed[posed.length - 1].id;
  await h.advance(1);

  // The torpedo is in flight and has moved, so the disc follows it.
  const dart = torpedoById(h.snapshot(), torpedoId);
  if (dart === undefined) {
    fail(
      "the posed torpedo still in flight, so the disc can be laid on it " +
        "(specs/weapons.md gives it TORPEDO_LIFE of 3.5 s)",
      "the torpedo roster no longer holds it",
    );
  }
  const painted = readPainted(h);
  const field = sampleField(painted);
  const heavy = readDisc(painted, { x: dart.x, y: dart.y }, TORPEDO_R);
  const light = readDisc(painted, BULLET_SPOT, BULLET_R);
  captureStill(h, "torpedo");

  assertGreaterThanOrEqual(
    markedCount(heavy, field, APART_FROM_FIELD),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${String(DISC_SAMPLES)} samples inside TORPEDO_R of the torpedo's ` +
      `centre, how many are more than ${String(APART_FROM_FIELD)} of 441 ` +
      "from the field the build drew (specs/overview.md)",
  );

  assertGreaterThan(
    colorDistance(inkOf(heavy, field, "torpedo"), inkOf(light, field, "round")),
    APART_FROM_BULLET,
    "the distance out of 441 between the colour the build drew the torpedo " +
      "in and the colour it drew a round in, which a player must tell apart " +
      "at a glance (specs/overview.md)",
  );
});
