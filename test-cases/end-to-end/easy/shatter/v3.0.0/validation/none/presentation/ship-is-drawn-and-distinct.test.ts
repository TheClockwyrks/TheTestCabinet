// presentation/ship-is-drawn-and-distinct — the ship reads apart from the field.
//
// THE RULE. `specs/overview.md`: "The ship reads apart from the field behind it and
// from every other body". Without it the player is flying something invisible.
//
// WHAT IS READ, AND AGAINST WHAT. `specs/overview.md` fixes no palette — "the
// palette, the type, the glow, and every other aspect of the look are yours" — so
// nothing here compares the canvas against a colour of its own. It reads the FIELD
// the build chose, at points where nothing is posed, and then reads the disc of
// `SHIP_R` about the ship's centre (`specs/ship.md` collides the ship as a circle of
// that radius centred on its position, and `specs/overview.md` makes an entity's
// position its centre), and asks how much of that disc the build painted something
// else on.
//
// WHY A COUNT AND NOT A MAXIMUM. One sample far from the background could be a
// single anti-aliased pixel of a body's edge; a count of them cannot be. And why
// not a majority: `specs/ship.md` draws the ship as a triangle and says nothing
// about filling it, so a hull drawn as a bare outline must pass. A one-unit outline
// of a triangle `34` long and `26` across covers about six per cent of the disc of
// `SHIP_R` about its centre, which is a little under thirty of these samples, so the
// bar is set well below that and far above what nothing-drawn scores, which is zero.
//
// THE POSE. An emptied, gated field with the ship moved off the safe point to
// `SHIP_SPOT`, which is `376` from the star's centre, so nothing of the star — drawn
// out to `180`, `specs/field.md` — reaches the disc being read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SHIP_R } from "../constants";
import {
  captureStill,
  createHarness,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc } from "./ink";
import { SHIP_SPOT } from "./scene";

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
 * How many of the {@link DISC_SAMPLES} readings inside `SHIP_R` must be the ship's.
 *
 * See the header: a bare one-unit triangle outline marks about thirty of them, so
 * this admits the thinnest hull the specification allows while a build that drew
 * nothing there scores nothing at all.
 */
const MIN_MARKED = 12;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("paints the disc of SHIP_R about the ship apart from the field behind it", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  await harness.advance(1);

  const field = await sampleField(harness);
  const ship = await readDisc(harness, SHIP_SPOT, SHIP_R);
  await captureStill(harness, "ship");

  assertGreaterThanOrEqual(
    markedCount(ship, field, SENSING_FLOOR),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside SHIP_R of the ship's centre, how many are more than ${SENSING_FLOOR} of 441 from the field the build drew (specs/overview.md)`,
  );
});
