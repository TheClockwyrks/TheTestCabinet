// presentation/rocks-are-drawn-and-distinct — a rock reads apart from the field and
// apart from the ship.
//
// THE RULE. `specs/overview.md`: "A rock reads apart from the field and from the
// ship, the saucer, and the bullets." This item owns the two halves a player needs
// most — a rock against the field it drifts over, and a rock against the ship the
// player is flying — and `presentation/saucer-is-drawn-and-distinct` owns the
// saucer's separation from a rock, so a build that told its rocks from its ship and
// not from its saucer fails one item rather than two.
//
// NO DRAWING STYLE IS ASSERTED. `specs/rocks.md` gives a rock a collision radius
// "whatever it is drawn as", and `specs/overview.md` closes its Visual design
// section by leaving the palette, the type and every other aspect of the look to the
// build. So this reads two things the BUILD drew — the disc a rock collides as, and
// the disc the ship collides as — and compares them with each other and with the
// field. A cratered rock, a textured one and a lumpy-but-round one are all legible
// and all pass.
//
// WHAT IS READ, IN TWO DIRECTIONS OF THE ONE RULE:
//
//   - AGAINST THE FIELD. How much of the disc of `ROCK_RADIUS.large` (`46`) about
//     the rock's centre is painted something the bare field is not.
//   - AGAINST THE SHIP. The mean colour of what was painted over the rock, against
//     the mean colour of what was painted over the ship. Only the MARKED samples
//     enter either mean, so the field behind an outline-drawn body never dilutes the
//     colour being compared.
//
// THE POSE. An emptied, gated field. The rock is a Large, the size a wave puts up
// (`specs/progression.md`) and the largest disc to read, posed at `ROCK_SPOT`, `350`
// from the star's centre — its whole circle clears the `180` nothing of the star is
// drawn beyond (`specs/field.md`) by more than three hundred units. The ship stands
// at `SHIP_SPOT`, `640` from the rock, so neither reading can reach the other body.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SHIP_R } from "../../src/constants";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
  type Rgb,
} from "../harness";
import {
  DISC_SAMPLES,
  markedColor,
  markedCount,
  readDisc,
  readPainted,
} from "./ink";
import { ROCK_SPOT, SHIP_SPOT, sampleField } from "./scene";

/** How far a sample must be from the field to be a body's, of 441. The item's figure. */
const APART = 60;

/**
 * How much of the disc of `ROCK_RADIUS.large` must be painted something other than
 * the field.
 *
 * Two fifths. `specs/rocks.md` fixes the circle a rock COLLIDES as and explicitly
 * leaves what it is drawn as to the build, so the drawn body need not fill that
 * circle: an irregular outline inscribed in it, or a body drawn a little inside it,
 * covers well over half the disc, and this leaves room for a build that draws a
 * smaller or more ragged rock. A build that drew nothing there covers none of it.
 */
const MIN_FRACTION = 0.4;

/**
 * How far a rock's colour must sit from the ship's, of 441.
 *
 * The item's own figure, and lower than the sixty either body is held apart from the
 * field by, on purpose: `specs/overview.md` requires the two to be TOLD APART, and
 * two bodies that both read against a dark field are already separated by their
 * shapes and their places. Forty of 441 is about a ninth of one channel's span —
 * enough that no two builds' greys could be confused, and low enough that a build
 * drawing both bodies in one family of colours is not failed for it.
 */
const TOLD_APART = 40;

/** The colour a body was drawn in, or the failure that it was drawn in nothing. */
function inkOf(look: readonly Rgb[], field: Rgb, body: string): Rgb {
  const found = markedColor(look, field, APART);
  if (found === null) {
    fail(
      `a colour the ${body} was drawn in, so the two bodies a player must ` +
        "tell apart can be compared (specs/overview.md)",
      `nothing inside the ${body} was drawn more than ${String(APART)} of 441 ` +
        "from the field",
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

it("paints a rock apart from the field and apart from the ship's own colour", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  poseRock(h, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  const rock = readDisc(painted, ROCK_SPOT, ROCK_RADIUS.large);
  const ship = readDisc(painted, SHIP_SPOT, SHIP_R);
  captureStill(h, "rock");

  assertGreaterThanOrEqual(
    markedCount(rock, field, APART),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${String(DISC_SAMPLES)} samples inside ROCK_RADIUS.large of a posed ` +
      `rock, how many are more than ${String(APART)} of 441 from the field ` +
      "the build drew (specs/overview.md)",
  );

  assertGreaterThan(
    colorDistance(inkOf(rock, field, "rock"), inkOf(ship, field, "ship")),
    TOLD_APART,
    "the RGB distance out of 441 between the colour the rock was drawn in and " +
      "the colour the ship was drawn in, which a player must tell apart " +
      "(specs/overview.md)",
  );
});
