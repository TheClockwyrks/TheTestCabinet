// Spectra — screens/inversion-overlay: an inversion marks the whole field.
//
// THE RULE. `specs/ui.md`: "While a spectral inversion is active the play field
// carries a field-wide mark that is absent otherwise, so a player sees at a glance
// that the bands are swapped." `specs/bands.md` says what an inversion IS — every
// drone and every enemy bullet reads as the opposite of its stored band for
// `INVERSION_TIME` (`5.0`) seconds — and `specs/field.md` fixes the play field as `y`
// in `[FIELD_TOP, FIELD_BOTTOM]` (`[64, 656]`), `x` in `[FIELD_LEFT, FIELD_RIGHT]`
// (`[0, 1280]`).
//
// WHAT IS MEASURED, AND WHY IT IS A MEAN. "Field-wide" is the word the specification
// chose, so what is read is the MEAN distance between the field with an inversion
// running and the same field without one, over every pixel of it. A mean, not a
// maximum: a mark on one corner would clear any maximum and is not field-wide, while a
// wash, a tint, a scanline, a border pattern repeated across the field or an inverted
// palette all move the mean. The review item states the figure: at least `20` of the
// `441` an RGB cube is across.
//
// THE FIELD IS EMPTY AND NOTHING ELSE MOVES. `startPosed` clears the four rosters and
// shuts the three world gates, so the two readings differ by exactly one thing — the
// inversion — and not by a drone that arrived, a bullet that travelled, or a life that
// was lost. Nothing on the field even reads as a different BAND between the two:
// `specs/bands.md` swaps drones and enemy bullets, and there are none.
//
// THE CONTROL. `specs/field.md` lets a build's starfield move if it likes, so the
// field's own frame-to-frame drift is measured first, with no inversion posed between
// the two readings, and the inversion's mark has to beat it as well as the stated
// figure.
//
// THE INVERSION IS POSED, NOT TRIGGERED. `setInversion` is what
// `specs/instrumentation.md` provides, and `inversionActive` is read back off the
// snapshot, so the reading is held against the state the BUILD believes it is in. What
// TRIGGERS an inversion is the `drones` group's, and what it swaps is the `bands`
// group's.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  regionDistance,
  startPosed,
  type Harness,
} from "../harness";
import { PLAY_FIELD, readRegion } from "./reading";

/**
 * How far apart the two fields must read, as a mean Euclidean RGB distance out of the
 * `441` an RGB cube is across.
 *
 * The figure the review item states. `20` is about a twentieth of the space averaged
 * over the WHOLE field, which a wash, a tint or a repeated pattern all reach and which
 * a mark on one corner cannot — and it is far above the fraction of a unit two readings
 * of one unchanged field differ by.
 */
const MARK_MIN = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("marks the whole play field while an inversion runs and not otherwise", async () => {
  startPosed(h);
  h.debug.setInversion(0);
  await h.advance(1);
  assertEqual(
    h.snapshot().inversionActive,
    false,
    "no inversion is running (specs/instrumentation.md)",
  );

  // What the field does on its own across one frame, with nothing posed: the
  // starfield's motion, if the build gave it any (specs/field.md).
  const plainFirst = readRegion(h, PLAY_FIELD);
  await h.advance(1);
  const plain = readRegion(h, PLAY_FIELD);
  captureStill(h, "plain");
  const drift = regionDistance(plainFirst, plain);

  h.debug.setInversion(INVERSION_TIME);
  await h.advance(1);
  const inverted = h.snapshot();
  assertEqual(
    inverted.inversionActive,
    true,
    "an inversion is running (specs/instrumentation.md); " +
      `${String(inverted.inversion)} seconds are left`,
  );
  const marked = readRegion(h, PLAY_FIELD);
  captureStill(h, "inverted");

  assertGreaterThan(
    regionDistance(plain, marked),
    Math.max(MARK_MIN, drift),
    "the mean RGB distance of 441 between the play field with an inversion " +
      "running and the same field without one, over every pixel of the field — " +
      "an active inversion carries a FIELD-WIDE mark that is absent otherwise " +
      "(specs/ui.md); the field moved on its own across one frame by " +
      `${drift.toFixed(2)}`,
  );
});
