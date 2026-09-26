// presentation/rocks-are-drawn-and-distinct — a rock is drawn on the field it
// drifts over.
//
// THE RULE. `specs/overview.md`: "A rock reads apart from the field and from the
// ship, the saucer, and the bullets." What a script can decide of that is the half
// that is presence — that the build painted something inside the circle a rock
// occupies. Whether the mark it chose reads apart at a glance is the picture the
// reviewer judges.
//
// ONE POSE. A Large is posed at `ROCK_SPOT` and the ship at `SHIP_SPOT`, `640`
// apart and each more than `300` from the star's centre, so the disc read here
// holds no part of the star (nothing of it is drawn beyond `180`,
// `specs/field.md`) and no part of the ship. The ship is posed rather than left
// where a game opens it precisely so it stands that far off; nothing about the
// ship is read.
//
// NOTHING HERE ASSERTS A COLOUR. The reading is a distance from the field the
// BUILD itself drew, taken at the bare points every check in this group reads the
// field at, and `specs/rocks.md` names no shape and no texture — "a build drawing
// cratered, textured or lumpy-but-round rocks is legible and conformant" — so what
// is asked for is a mark, not a mark drawn a particular way.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { ROCK_RADIUS } from "../constants";
import {
  captureStill,
  createHarness,
  poseRock,
  requireRock,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc } from "./ink";
import { ROCK_SPOT, SHIP_SPOT } from "./scene";

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
 * How many of the {@link DISC_SAMPLES} readings inside a Large must be painted.
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

it("paints a rock on the field", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  const id = await poseRock(harness, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  await harness.advance(1);

  const rock = requireRock(await harness.snapshot(), id, "the posed Large");
  const field = await sampleField(harness);
  const look = await readDisc(harness, rock, ROCK_RADIUS.large);
  await captureStill(harness, "rock");

  assertGreaterThanOrEqual(
    markedCount(look, field, SENSING_FLOOR),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside the Large, how many are more than ${SENSING_FLOOR} of 441 from the field the build drew (specs/overview.md)`,
  );
});
