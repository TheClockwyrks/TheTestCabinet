// field/targeting-ignores-hexes-off-the-field — a hex outside the field is never
// targeted.
//
// THE RULE. "The pointer targets the FIELD HEX whose center is nearest to the
// pointer position" (`specs/field.md`, Targeting a hex), and a field hex is
// exactly one of the ninety-one: "the field is the hexagonal region of radius
// `FIELD_R` around `(0, 0)`: hex `(q, r)` is on the field exactly when
// `max(|q|, |r|, |q + r|) <= FIELD_R`". The axial formulas compute a center for
// every `(q, r)` there is, the field's region on the stage is wider than the
// field itself, and the targeting rule ranges over the ninety-one alone.
//
// THE CONFIGURATION. The computed center of hex `(6, 0)`:
// `max(6, 0, 6)` is `6`, past `FIELD_R` (`5`), so it is not a field hex — while
// its center lies inside the field's own region of `specs/editor.md`, "`x`
// `TRAY_REGION_W` (`224`) to `READOUT_X0` (`1008`), `y` `HEADING_H` (`48`) to
// `TAPE_Y0` (`560`)", so the pointer really is over the field's panel rather than
// over the readout. The nearest field hex center is `(5, 0)`'s, `HEX_PITCH`
// (`48`) away and so past `HEX_HIT_R` (`26`), which the check reads back off the
// specification's own formulas before asking the build anything.
//
// THE CONTROL. The same drag is walked onto `(5, 0)`'s center first and reports
// `(5, 0)`, so the `null` that follows is the field's edge rather than a build
// that never targets anything — and `(5, 0)` is the very hex `(6, 0)` would be
// mistaken for.
//
// THE WORLD IS POSED, NOT SEARCHED. `BARE` is loaded as a challenge document and
// the machine emptied, so no part is on the field, and there is no live run,
// which would reduce a press on the field to a focus change. The drag is released
// where it stands, over no hex, which "places nothing".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNull,
  assertTrue,
  fail,
} from "../assert";
import { FIELD_R, HEX_HIT_R } from "../constants";
import {
  at,
  contains,
  distance,
  fieldHexes,
  FIELD_REGION,
  hexCenter,
  onField,
  traySlot,
  type Hex,
} from "../field";
import { BARE } from "../fixtures";
import {
  captureStill,
  centerOf,
  createHarness,
  moveTo,
  openChallengeDocument,
  pressAt,
  releasePointer,
  type Harness,
} from "../harness";

let h: Harness;

/** One ring past the field's edge, due east: `max(6, 0, 6)` is past `FIELD_R`. */
const BEYOND: Hex = at(FIELD_R + 1, 0);

/** The field hex it would be mistaken for. */
const EDGE: Hex = at(FIELD_R, 0);

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports at as null over the center of a hex outside the field", async () => {
  assertTrue(
    !onField(BEYOND),
    "(6, 0) has max(|q|, |r|, |q + r|) past FIELD_R, so it is not a field hex",
  );
  assertTrue(
    contains(FIELD_REGION, hexCenter(BEYOND)),
    "(6, 0)'s computed center lies inside the field's region of specs/editor.md",
  );
  for (const hex of fieldHexes()) {
    assertGreaterThan(
      distance(hexCenter(BEYOND), hexCenter(hex)),
      HEX_HIT_R,
      `(${hex.q}, ${hex.r}) is farther than HEX_HIT_R from (6, 0)'s center`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, hexCenter(EDGE));
  const control = (await h.snapshot()).editor.drag;

  await moveTo(h, hexCenter(BEYOND));
  await h.advance(1);
  await captureStill(h, "off-field");

  const drag = (await h.snapshot()).editor.drag;
  await releasePointer(h);

  if (control === null || control.kind !== "place") {
    fail(
      'a live place drag, reported as editor.drag with kind "place"',
      control,
    );
  }
  assertEqual(
    control.at?.q,
    EDGE.q,
    "the same drag targets (5, 0) on its center, so this drag does target hexes: q",
  );
  assertEqual(
    control.at?.r,
    EDGE.r,
    "the same drag targets (5, 0) on its center, so this drag does target hexes: r",
  );

  if (drag === null || drag.kind !== "place") {
    fail('a live place drag, reported as editor.drag with kind "place"', drag);
  }
  assertNull(
    drag.at,
    "only the ninety-one hexes on the field are targeted, so (6, 0) is not",
  );
});
