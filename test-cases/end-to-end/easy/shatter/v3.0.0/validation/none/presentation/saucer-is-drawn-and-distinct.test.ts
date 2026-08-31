// presentation/saucer-is-drawn-and-distinct — the saucer reads apart from the field
// and apart from the rocks it hunts among.
//
// THE RULE. `specs/overview.md`: "The saucer reads apart from the rocks and from the
// ship, as a craft rather than as debris." A saucer that reads as a rock is a rock
// the player shoots at while it shoots back.
//
// WHAT IS READ. The disc of `SAUCER_R` (`18`, `specs/saucer.md`) about the saucer's
// centre, and the disc of a Large posed across the field from it, both against the
// field the build drew at points that hold neither. The two colours the build chose
// are then compared with each other. Nothing here asserts a palette or a silhouette:
// "as a craft rather than as debris" is a reviewer's reading of the picture this
// leaves behind, and what a script can decide is that the two are told apart.
//
// THE SAUCER IS POSED WITH ALL THREE OF ITS FACULTIES OFF — no mind, no gun, no
// travel (`specs/saucer.md` gives it three separable ones, and
// `validation/none/harness.ts` poses them separately for exactly this). A saucer
// that steered, moved or fired would carry its own bullets into the disc being read
// and drift off the point the disc was laid on. What is left is a craft standing
// still to be looked at, which is the whole of what this item decides.
//
// WHY THE TWO BOUNDS DIFFER is the note in `rocks-are-drawn-and-distinct`: sixty of
// 441 separates a body from a field that is dark by requirement, forty separates two
// bodies a build drew to be seen against it. Both are the item's own figures.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertGreaterThanOrEqual, fail } from "../assert";
import { ROCK_RADIUS, SAUCER_R } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  poseSaucer,
  requireRock,
  requireSaucer,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedColor, markedCount, readDisc } from "./ink";
import { FAR_SHIP, ROCK_SPOT, SAUCER_SPOT } from "./scene";

/** How far a sample must be from the field to be a body's, of 441. The item's figure. */
const APART_FROM_FIELD = 60;

/** How far the saucer's colour must be from the rock's, of 441. The item's figure. */
const APART_FROM_ROCK = 40;

/**
 * How many of the {@link DISC_SAMPLES} readings inside `SAUCER_R` must be the craft's.
 *
 * A saucer drawn as a bare one-unit outline of a flattened disc marks something over
 * fifty of these samples; the bar sits well under that, so a lightly drawn craft
 * passes while a build that drew nothing there scores zero.
 */
const MIN_MARKED = 15;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("paints the saucer apart from the field and apart from a rock", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  const rockId = await poseRock(harness, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  await poseSaucer(harness, SAUCER_SPOT.x, SAUCER_SPOT.y, {
    mind: false,
    gun: false,
    travel: false,
  });
  await harness.advance(1);

  const snapshot = await harness.snapshot();
  const saucer = requireSaucer(snapshot, "the posed saucer");
  const rock = requireRock(snapshot, rockId, "the posed Large");
  const field = await sampleField(harness);
  const craft = await readDisc(harness, saucer, SAUCER_R);
  const debris = await readDisc(harness, rock, ROCK_RADIUS.large);
  await captureStill(harness, "saucer");

  assertGreaterThanOrEqual(
    markedCount(craft, field, APART_FROM_FIELD),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside SAUCER_R of the saucer's centre, how many are more than ${APART_FROM_FIELD} of 441 from the field the build drew (specs/overview.md)`,
  );

  const saucerColor = markedColor(craft, field, APART_FROM_FIELD);
  const rockColor = markedColor(debris, field, APART_FROM_FIELD);
  if (saucerColor === null || rockColor === null) {
    fail(
      "both a saucer and a rock drawn apart from the field, so their colours can be compared (specs/overview.md)",
      saucerColor === null
        ? "nothing was drawn inside the saucer"
        : "nothing was drawn inside the rock",
    );
  }

  assertGreaterThan(
    colorDistance(saucerColor, rockColor),
    APART_FROM_ROCK,
    "the distance out of 441 between the colour the build drew the saucer in and the colour it drew a rock in (specs/overview.md)",
  );
});
