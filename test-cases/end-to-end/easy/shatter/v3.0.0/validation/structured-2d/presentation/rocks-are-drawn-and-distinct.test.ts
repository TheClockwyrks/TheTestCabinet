// presentation/rocks-are-drawn-and-distinct — a rock is drawn on the field it
// drifts over.
//
// THE RULE. `specs/overview.md`: "A rock reads apart from the field and from the
// ship, the saucer, and the bullets." What a script can decide of that is the half
// that is presence — that the build painted something inside the circle a rock
// occupies. Whether the mark it chose reads apart at a glance is the picture the
// reviewer judges.
//
// NO DRAWING STYLE IS ASSERTED. `specs/rocks.md` gives a rock a collision radius
// "whatever it is drawn as", and `specs/overview.md` closes its Visual design
// section by leaving the palette, the type and every other aspect of the look to
// the build. So this reads one thing the BUILD drew — the disc a rock collides as —
// against another, the field the build itself painted behind it. A cratered rock, a
// textured one and a lumpy-but-round one are all legible and all pass.
//
// THE POSE. An emptied, gated field. The rock is a Large, the size a wave puts up
// (`specs/progression.md`) and the largest disc to read, posed at `ROCK_SPOT`,
// `350` from the star's centre — its whole circle clears the `180` nothing of the
// star is drawn beyond (`specs/field.md`) by more than three hundred units. The
// ship stands at `SHIP_SPOT`, `640` from the rock, so nothing the ship is drawn as
// can reach the disc being read; nothing about the ship itself is read.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseRock,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc, readPainted } from "./ink";
import { ROCK_SPOT, SHIP_SPOT, sampleField } from "./scene";

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
 * one-unit outline covers about four per cent of it — a little under twenty of
 * these samples. The bar sits below that, so the thinnest legible rock passes and
 * a build that drew nothing there, which scores zero, does not. `specs/rocks.md`
 * fixes the circle a rock COLLIDES as and leaves what it is drawn as to the build,
 * so the floor is a presence reading rather than a fill fraction: a filled body,
 * a cratered one and a bare outline all clear it.
 */
const MIN_MARKED = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints a rock on the field", async () => {
  startPlaying(h);
  h.debug.setShipPosition(SHIP_SPOT.x, SHIP_SPOT.y);
  poseRock(h, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  const rock = readDisc(painted, ROCK_SPOT, ROCK_RADIUS.large);
  captureStill(h, "rock");

  assertGreaterThanOrEqual(
    markedCount(rock, field, SENSING_FLOOR),
    MIN_MARKED,
    `of ${String(DISC_SAMPLES)} samples inside ROCK_RADIUS.large of a posed ` +
      `rock, how many are more than ${String(SENSING_FLOOR)} of 441 from the field ` +
      "the build drew (specs/overview.md)",
  );
});
