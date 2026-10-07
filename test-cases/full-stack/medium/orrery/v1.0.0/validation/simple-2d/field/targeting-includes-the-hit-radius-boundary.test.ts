// field/targeting-includes-the-hit-radius-boundary — the hit radius includes its
// own boundary.
//
// THE RULE. "The pointer targets the field hex whose center is nearest to the
// pointer position, provided that distance is at most `HEX_HIT_R` (`26`)"
// (`specs/field.md`, Targeting a hex). "At most" admits the boundary itself: a
// distance of exactly `HEX_HIT_R` targets the hex, and only a distance greater
// than it targets none. This is the one point in the rule where a build that
// wrote `<` for `<=` still behaves correctly everywhere else.
//
// THE CONFIGURATION. Exactly `HEX_HIT_R` (`26`) due north of hex `(0, 0)`'s
// computed center, toward the vertex a pointy-top hex carries there. On that
// bearing the two centers flanking the vertex are the nearest others, and the
// check reads back from the specification's own formulas that every other field
// hex center is farther than `26` before asking the build anything — so `(0, 0)`
// is the nearest center as well as being exactly at the bound.
//
// WHAT IS READ. A live place drag reports its target: "a press begins it, each
// pointer move retargets it" (`specs/editor.md`, Dragging), carried in the
// snapshot as `editor.drag` with "`at`: the targeted hex, `null` off every hex"
// (`specs/instrumentation.md`). Nothing is placed and nothing is committed.
//
// THE WORLD IS POSED, NOT SEARCHED. `BARE` is loaded as a challenge document and
// the machine emptied, so no part is on the field to take the press instead, and
// there is no live run, which would reduce a press on the field to a focus
// change. The drag is released off every hex, which "places nothing".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan, fail } from "../assert";
import { FIELD_CX, FIELD_CY, HEX_HIT_R } from "../constants";
import {
  distance,
  fieldHexes,
  hexCenter,
  sameHex,
  traySlot,
  type StagePoint,
} from "../field";
import { BARE, ORIGIN } from "../fixtures";
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

/** Exactly `HEX_HIT_R` due north of `(0, 0)`, on its own vertex bearing. */
const ON_THE_BOUND: StagePoint = { x: FIELD_CX, y: FIELD_CY - HEX_HIT_R };

/** A stage point no field hex center lies within `HEX_HIT_R` of. */
const OFF_EVERY_HEX: StagePoint = { x: 616, y: 8 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("targets (0, 0) from exactly HEX_HIT_R away", async () => {
  assertCloseTo(
    distance(ON_THE_BOUND, hexCenter(ORIGIN)),
    HEX_HIT_R,
    6,
    "the point is exactly HEX_HIT_R from the center of (0, 0)",
  );
  for (const hex of fieldHexes()) {
    if (sameHex(hex, ORIGIN)) continue;
    assertGreaterThan(
      distance(ON_THE_BOUND, hexCenter(hex)),
      HEX_HIT_R,
      `(${hex.q}, ${hex.r}) is farther from the point than HEX_HIT_R`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, ON_THE_BOUND);
  await h.advance(1);
  await captureStill(h, "boundary");

  const drag = (await h.snapshot()).editor.drag;
  await moveTo(h, OFF_EVERY_HEX);
  await releasePointer(h);

  if (drag === null || drag.kind !== "place") {
    fail('a live place drag, reported as editor.drag with kind "place"', drag);
  }
  assertEqual(
    drag.at?.q,
    ORIGIN.q,
    "specs/field.md admits a distance of at most HEX_HIT_R, so the bound itself targets: q",
  );
  assertEqual(
    drag.at?.r,
    ORIGIN.r,
    "specs/field.md admits a distance of at most HEX_HIT_R, so the bound itself targets: r",
  );
});
