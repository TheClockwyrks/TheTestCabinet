// presentation/torpedo-is-drawn-and-distinct — the torpedo is drawn on the field
// it flies over. `warhead` only.
//
// THE RULE. `specs/overview.md`'s legibility table, under `warhead`: "The torpedo |
// The torpedo reads apart from the bullets at a glance, as the heavy weapon rather
// than a round." What a script can decide of that is the half that is presence —
// that the build painted a dart where one is in flight. Whether it reads as the
// heavy weapon at a glance is the picture the reviewer judges.
//
// WHAT IS READ. The disc of `TORPEDO_R` (`6`, `specs/collision.md`) about the
// torpedo's centre, against the field the build itself drew at points where nothing
// is posed. Nothing here asserts a palette or a silhouette.
//
// THE TORPEDO CANNOT BE POSED AT REST, because `addTorpedo` puts one in flight at
// `TORPEDO_SPEED` (`specs/instrumentation.md`) and no operation stops it. So its
// centre is re-read off the build's own snapshot before the disc is laid on it, and
// the samples follow the torpedo rather than the place it was posed. The field holds
// no rock and no saucer, so there is nothing for its guidance to turn onto in any
// case.

import { afterEach, beforeEach, it } from "vitest";
import { TORPEDO_R } from "../constants";
import { assertGreaterThanOrEqual, fail } from "../assert";
import type { Vec } from "../geometry";
import {
  captureStill,
  createHarness,
  startPlaying,
  torpedoById,
  torpedoesOf,
  type Harness,
} from "../harness";
import { requireOp } from "../surface";
import { DISC_SAMPLES, markedCount, readDisc, readPainted } from "./ink";
import { FAR_SHIP, sampleField } from "./scene";

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
 * Far enough from the ship at `FAR_SHIP` that neither is drawn anywhere near the
 * other, and far enough from the star that the well pulls on nothing being read — a
 * torpedo it never pulls at all (`specs/gravity.md`). Its whole drawn extent is `60`
 * clear of the bottom seam.
 */
const TORPEDO_SPOT: Vec = { x: 980, y: 660 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the torpedo on the field", async () => {
  startPlaying(h);
  h.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
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
  captureStill(h, "torpedo");

  assertGreaterThanOrEqual(
    markedCount(heavy, field, SENSING_FLOOR),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${String(DISC_SAMPLES)} samples inside TORPEDO_R of the torpedo's ` +
      `centre, how many are more than ${String(SENSING_FLOOR)} of 441 ` +
      "from the field the build drew (specs/overview.md)",
  );
});
