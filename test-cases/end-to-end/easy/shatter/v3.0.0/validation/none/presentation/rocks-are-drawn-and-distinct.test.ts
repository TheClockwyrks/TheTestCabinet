// presentation/rocks-are-drawn-and-distinct — a rock reads apart from the field it
// drifts on, and apart from the ship the player is flying.
//
// THE RULE. `specs/overview.md`: "A rock reads apart from the field and from the
// ship, the saucer, and the bullets." A rock that reads as the field is a rock the
// player flies into; a rock that reads as the ship is a rock the player mistakes for
// themselves.
//
// TWO READINGS, ONE POSE. A Large is posed at `ROCK_SPOT` and the ship at
// `SHIP_SPOT`, `640` apart and each more than `300` from the star's centre, so
// neither disc holds any of the star (nothing of it is drawn beyond `180`,
// `specs/field.md`) or any of the other. The field is read at the bare points that
// hold neither.
//
// NOTHING HERE ASSERTS A COLOUR, only two distances between colours the BUILD
// chose: the rock against the field, and the rock against the ship. `specs/overview.md`
// leaves the palette to the build, and `specs/rocks.md` names no shape and no
// texture — "a build drawing cratered, textured or lumpy-but-round rocks is legible
// and conformant" — so what is asked for is a mark that is told apart, not a mark
// drawn a particular way.
//
// WHY THE TWO BOUNDS DIFFER. Sixty of 441 separates a body from the FIELD, which is
// dark by requirement (`specs/overview.md`) while everything on it is drawn to be
// seen: the gap there is wide by construction. Forty separates two BODIES, both of
// which a build drew to be visible against that same dark field, so they may sit
// nearer each other in colour and still be told apart. Both are the item's own
// figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import { ROCK_RADIUS, SHIP_R } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  requireRock,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedColor, markedCount, readDisc } from "./ink";
import { ROCK_SPOT, SHIP_SPOT } from "./scene";

/** How far a sample must be from the field to be a body's, of 441. The item's figure. */
const APART_FROM_FIELD = 60;

/** How far the rock's colour must be from the ship's, of 441. The item's figure. */
const APART_FROM_SHIP = 40;

/**
 * How many of the {@link DISC_SAMPLES} readings inside a Large must be the rock's.
 *
 * A Large is a disc of radius `46` (`specs/rocks.md`), and a rock drawn as a bare
 * one-unit outline covers about four per cent of it — a little under twenty of these
 * samples. The bar sits below that, so the thinnest legible rock passes and a build
 * that drew nothing there, which scores zero, does not.
 */
const MIN_MARKED = 15;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("paints a rock apart from the field and apart from the ship", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  const id = await poseRock(harness, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  await harness.advance(1);

  const rock = requireRock(await harness.snapshot(), id, "the posed Large");
  const field = await sampleField(harness);
  const look = await readDisc(harness, rock, ROCK_RADIUS.large);
  const hull = await readDisc(harness, SHIP_SPOT, SHIP_R);
  await captureStill(harness, "rock");

  assertGreaterThanOrEqual(
    markedCount(look, field, APART_FROM_FIELD),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside the Large, how many are more than ${APART_FROM_FIELD} of 441 from the field the build drew (specs/overview.md)`,
  );

  const rockColor = markedColor(look, field, APART_FROM_FIELD);
  const shipColor = markedColor(hull, field, APART_FROM_FIELD);
  if (rockColor === null || shipColor === null) {
    fail(
      "both a rock and a ship drawn apart from the field, so their colours can be compared (specs/overview.md)",
      rockColor === null ? "nothing was drawn inside the rock" : "nothing was drawn inside the ship",
    );
  }

  assertGreaterThan(
    colorDistance(rockColor, shipColor),
    APART_FROM_SHIP,
    "the distance out of 441 between the colour the build drew the rock in and the colour it drew the ship in (specs/overview.md)",
  );
});
