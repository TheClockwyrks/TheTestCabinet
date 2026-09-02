// presentation/saucer-is-drawn-and-distinct — the saucer reads apart from the
// field and apart from a rock.
//
// THE RULE. `specs/overview.md`: "The saucer reads apart from the rocks and from
// the ship, as a craft rather than as debris." The rock is the comparison this
// item makes, because it is the one that matters in play: a saucer mistaken for a
// drifting rock is shot at leisurely and kills the player.
//
// WHAT IS READ, IN TWO DIRECTIONS OF THE ONE RULE:
//
//   - AGAINST THE FIELD. How much of the disc of `SAUCER_R` (`18`,
//     `specs/saucer.md`) about the craft's centre is painted something the bare
//     field is not.
//   - AGAINST A ROCK. The mean colour of what was painted over the saucer, against
//     the mean colour of what was painted over a Large posed elsewhere on the same
//     frame. Only the MARKED samples enter either mean, so the field showing
//     through a flattened silhouette never dilutes the colour being compared.
//
// NO SILHOUETTE IS ASSERTED. `specs/saucer.md` draws the craft as "a flattened
// disc, a flying-saucer silhouette" and collides it as a circle of `SAUCER_R`; how
// much of that circle the drawing fills is the build's, so the bar below is set
// for a flattened body rather than for a filled one, and nothing here reads a
// shape.
//
// THE POSE. An emptied, gated field, with the visit held still and disarmed:
// `setSaucerTravel(false)` holds its centre where it stands and
// `setSaucerGun(false)` stops the aimed shot it would otherwise take
// (`specs/instrumentation.md`), so the craft is posed with only the faculty this
// item reads — being drawn — and no round of its own can land inside the disc. It
// stands at `SAUCER_SPOT`, `280` below the star's centre, clear of the `180`
// nothing of the star is drawn beyond (`specs/field.md`), and the rock stands
// `316` away at `ROCK_SPOT`.

import { afterEach, beforeEach, it } from "vitest";
import { ROCK_RADIUS, SAUCER_R } from "../constants";
import {
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertNotNull,
} from "../assert";
import {
  captureStill,
  colorDistance,
  createHarness,
  poseRock,
  poseSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import {
  DISC_SAMPLES,
  markedColor,
  markedCount,
  readDisc,
  readPainted,
} from "./ink";
import { ROCK_SPOT, SAUCER_SPOT, sampleField } from "./scene";

/** How far a sample must be from the field to be a body's, of 441. The item's figure. */
const APART = 60;

/**
 * How much of the disc of `SAUCER_R` must be painted something other than the
 * field.
 *
 * Three tenths. `specs/saucer.md` makes the craft a FLATTENED disc inside the
 * circle of `SAUCER_R` it collides as, so a conformant silhouette covers a
 * fraction of that circle rather than all of it: an ellipse half as tall as it is
 * wide covers a half, and one a third as tall covers a third. This admits the
 * flattest such body and still scores nothing at all for a build that drew none.
 */
const MIN_FRACTION = 0.3;

/**
 * How far the saucer's colour must sit from a rock's, of 441.
 *
 * The item's own figure, and the same separation `rocks-are-drawn-and-distinct`
 * holds a rock and the ship to. About a ninth of one channel's span: enough that a
 * craft and a rock cannot be confused at a glance, and low enough that a build
 * drawing both in one family of colours is not failed for the family alone.
 */
const TOLD_APART = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the saucer apart from the field and apart from a rock's own colour", async () => {
  startPlaying(h);
  poseSaucer(h, SAUCER_SPOT.x, SAUCER_SPOT.y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(false);
  poseRock(h, "large", ROCK_SPOT.x, ROCK_SPOT.y);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  const saucer = readDisc(painted, SAUCER_SPOT, SAUCER_R);
  const rock = readDisc(painted, ROCK_SPOT, ROCK_RADIUS.large);
  captureStill(h, "saucer");

  assertGreaterThanOrEqual(
    markedCount(saucer, field, APART),
    Math.round(MIN_FRACTION * DISC_SAMPLES),
    `of ${DISC_SAMPLES} samples inside SAUCER_R of the posed saucer, how many ` +
      `are more than ${APART} of 441 from the field the build drew ` +
      "(specs/overview.md)",
  );

  const saucerInk = markedColor(saucer, field, APART);
  const rockInk = markedColor(rock, field, APART);
  assertNotNull(
    saucerInk,
    "a colour the saucer was drawn in, so it can be compared with a rock's " +
      "(specs/overview.md)",
  );
  assertNotNull(
    rockInk,
    "a colour the rock was drawn in, so the saucer can be compared with it " +
      "(specs/overview.md)",
  );

  assertGreaterThan(
    colorDistance(saucerInk!, rockInk!),
    TOLD_APART,
    "the RGB distance out of 441 between the colour the saucer was drawn in " +
      "and the colour a rock was drawn in, which a player must tell apart " +
      "(specs/overview.md)",
  );
});
