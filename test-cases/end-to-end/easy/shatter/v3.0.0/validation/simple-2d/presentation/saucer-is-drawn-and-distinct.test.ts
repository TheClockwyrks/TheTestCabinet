// presentation/saucer-is-drawn-and-distinct — the saucer is drawn on the field it
// hunts across.
//
// THE RULE. `specs/overview.md`: "The saucer reads apart from the rocks and from
// the ship, as a craft rather than as debris." What a script can decide of that is
// the half that is presence — that the build painted a craft where one is visiting.
// "As a craft rather than as debris" is a reading of the picture, which the
// reviewer judges.
//
// WHAT IS READ. How much of the disc of `SAUCER_R` (`18`, `specs/saucer.md`) about
// the craft's centre is painted something the bare field is not.
//
// NO SILHOUETTE IS ASSERTED. `specs/saucer.md` draws the craft as "a flattened
// disc, a flying-saucer silhouette" and collides it as a circle of `SAUCER_R`; how
// much of that circle the drawing fills is the build's — a filled body, or the
// bare outline of one — so the bar below is a presence floor rather than a fill
// fraction, and nothing here reads a shape or an extent.
//
// THE POSE. An emptied, gated field, with the visit held still and disarmed:
// `setSaucerTravel(false)` holds its centre where it stands and
// `setSaucerGun(false)` stops the aimed shot it would otherwise take
// (`specs/instrumentation.md`), so the craft is posed with only the faculty this
// item reads — being drawn — and no round of its own can land inside the disc. It
// stands at `SAUCER_SPOT`, `280` below the star's centre, clear of the `180`
// nothing of the star is drawn beyond (`specs/field.md`).

import { afterEach, beforeEach, it } from "vitest";
import { SAUCER_R } from "../constants";
import { assertGreaterThanOrEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseSaucer,
  startPlaying,
  type Harness,
} from "../harness";
import { DISC_SAMPLES, markedCount, readDisc, readPainted } from "./ink";
import { SAUCER_SPOT, sampleField } from "./scene";

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
 * How many of the {@link DISC_SAMPLES} readings inside `SAUCER_R` must be the
 * craft's.
 *
 * A saucer drawn as a bare one-unit outline of a flattened disc marks something
 * over fifty of these samples; the bar sits well under that, so a lightly drawn
 * craft passes while a build that drew nothing there scores zero.
 */
const MIN_MARKED = 15;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("paints the saucer on the field", async () => {
  startPlaying(h);
  poseSaucer(h, SAUCER_SPOT.x, SAUCER_SPOT.y);
  h.debug.setSaucerTravel(false);
  h.debug.setSaucerGun(false);
  await h.advance(1);

  const painted = readPainted(h);
  const field = sampleField(painted);
  const saucer = readDisc(painted, SAUCER_SPOT, SAUCER_R);
  captureStill(h, "saucer");

  assertGreaterThanOrEqual(
    markedCount(saucer, field, SENSING_FLOOR),
    MIN_MARKED,
    `of ${DISC_SAMPLES} samples inside SAUCER_R of the posed saucer, how many ` +
      `are more than ${SENSING_FLOOR} of 441 from the field the build drew ` +
      "(specs/overview.md)",
  );
});
