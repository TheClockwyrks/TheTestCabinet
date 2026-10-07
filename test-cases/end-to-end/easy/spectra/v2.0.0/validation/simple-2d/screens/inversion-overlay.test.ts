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
// WHAT IS MEASURED. How many pixels of the play field the inversion repainted, over
// every pixel of it: the field with an inversion running, held pixel for pixel
// against the same field without one. A wash, a tint, a scanline, a border pattern
// repeated across the field and an inverted palette all repaint pixels the plain
// field does not carry; a build that draws nothing at all repaints none. How BROADLY
// the mark reads across the field, and what it looks like, are the reviewer's
// presentation rating.
//
// THE FIELD IS EMPTY AND NOTHING ELSE MOVES. `startPosed` clears the four rosters and
// shuts the three world gates, so the two readings differ by exactly one thing — the
// inversion — and not by a drone that arrived, a bullet that travelled, or a life that
// was lost. Nothing on the field even reads as a different BAND between the two:
// `specs/bands.md` swaps drones and enemy bullets, and there are none.
//
// THE CONTROL. `specs/field.md` lets a build's starfield move if it likes, so the
// field's own frame-to-frame drift is measured first, with no inversion posed between
// the two readings, and the inversion's mark has to beat it.
//
// THE INVERSION IS POSED, NOT TRIGGERED. `setInversion` is what
// `specs/instrumentation.md` provides, and `inversionActive` is read back off the
// snapshot, so the reading is held against the state the BUILD believes it is in.
// What TRIGGERS an inversion is the `drones` group's, and what it swaps is the `bands`
// group's.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  readRegion,
  startPosed,
  type Harness,
} from "../harness";
import { PAINT_MIN, PLAY_FIELD, countMoved } from "./reading";

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
  const drift = countMoved(plainFirst, plain, PAINT_MIN);

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
    countMoved(plain, marked, PAINT_MIN),
    drift,
    "pixels of the play field the inversion repainted, over every pixel of the " +
      "field — an active inversion carries a mark that is absent otherwise " +
      "(specs/ui.md); the field moved on its own across one frame in " +
      `${String(drift)} pixels`,
  );
});
