// presentation/saucer-is-drawn-and-distinct — the saucer is drawn on the field it
// hunts across.
//
// THE RULE. `specs/overview.md`: "The saucer reads apart from the rocks and from the
// ship, as a craft rather than as debris." What a script can decide of that is the
// half that is presence — that the build painted a craft where one is visiting.
// "As a craft rather than as debris" is a reading of the picture, which the
// reviewer judges.
//
// WHAT IS READ. The disc of `SAUCER_R` (`18`, `specs/saucer.md`) about the saucer's
// centre, against the field the build drew at points that hold no body. Nothing
// here asserts a palette or a silhouette.
//
// THE SAUCER IS POSED WITH ALL THREE OF ITS FACULTIES OFF — no mind, no gun, no
// travel (`specs/saucer.md` gives it three separable ones, and
// `validation/none/harness.ts` poses them separately for exactly this). A saucer
// that steered, moved or fired would carry its own bullets into the disc being read
// and drift off the point the disc was laid on. What is left is a craft standing
// still to be looked at, which is the whole of what this item decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { SAUCER_R } from "../constants";
import {
  captureStill,
  createHarness,
  poseSaucer,
  requireSaucer,
  sampleField,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc } from "./ink";
import { FAR_SHIP, SAUCER_SPOT } from "./scene";

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

it("paints the saucer on the field", async () => {
  await startPlaying(harness);
  await harness.debug.setShipPosition(FAR_SHIP.x, FAR_SHIP.y);
  await poseSaucer(harness, SAUCER_SPOT.x, SAUCER_SPOT.y, {
    mind: false,
    gun: false,
    travel: false,
  });
  await harness.advance(1);

  const saucer = requireSaucer(await harness.snapshot(), "the posed saucer");
  const field = await sampleField(harness);
  const craft = await readDisc(harness, saucer, SAUCER_R);
  await captureStill(harness, "saucer");

  assertGreaterThanOrEqual(
    markedCount(craft, field, SENSING_FLOOR),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside SAUCER_R of the saucer's centre, how many are more than ${SENSING_FLOOR} of 441 from the field the build drew (specs/overview.md)`,
  );
});
