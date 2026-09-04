// field/targeting-holds-within-the-hit-radius — a pointer inside the hit radius
// still targets its hex.
//
// THE RULE. "The pointer targets the field hex whose center is nearest to the
// pointer position, provided that distance is at most `HEX_HIT_R` (`26`)"
// (`specs/field.md`, Targeting a hex). The radius is the whole of the tolerance a
// player is given: anywhere inside it the hex is still taken, not only on the
// center. `HEX_HIT_R` (`26`) is more than the `HEX_PITCH / 2` (`24`) at which two
// neighbouring centers meet, so the reading is only unambiguous away from that
// meeting point — which is why the point is taken along a VERTEX direction.
//
// THE CONFIGURATION. `HEX_HIT_R - 1` (`25`) due north of hex `(0, 0)`'s computed
// center, toward the vertex a pointy-top hex carries there. On that bearing the
// two centers that flank the vertex are the nearest others, and the check reads
// back from the specification's own formulas that every other field hex center is
// farther than `25` before asking the build anything — so a build that answered
// `(0, 0)` cannot have answered it by taking some nearer hex.
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

/** `HEX_HIT_R - 1` due north of `(0, 0)`, toward a pointy-top hex's own vertex. */
const INSIDE: StagePoint = { x: FIELD_CX, y: FIELD_CY - (HEX_HIT_R - 1) };

/** A stage point no field hex center lies within `HEX_HIT_R` of. */
const OFF_EVERY_HEX: StagePoint = { x: 616, y: 8 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("targets (0, 0) from HEX_HIT_R - 1 away, along its vertex bearing", async () => {
  assertCloseTo(
    distance(INSIDE, hexCenter(ORIGIN)),
    HEX_HIT_R - 1,
    6,
    "the point is HEX_HIT_R - 1 from the center of (0, 0)",
  );
  for (const hex of fieldHexes()) {
    if (sameHex(hex, ORIGIN)) continue;
    assertGreaterThan(
      distance(INSIDE, hexCenter(hex)),
      HEX_HIT_R - 1,
      `(${hex.q}, ${hex.r}) is farther from the point than (0, 0) is`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, INSIDE);
  await h.advance(1);
  await captureStill(h, "inside");

  const drag = (await h.snapshot()).editor.drag;
  await moveTo(h, OFF_EVERY_HEX);
  await releasePointer(h);

  if (drag === null || drag.kind !== "place") {
    fail('a live place drag, reported as editor.drag with kind "place"', drag);
  }
  assertEqual(
    drag.at?.q,
    ORIGIN.q,
    "a pointer within HEX_HIT_R of a center targets that hex rather than none: q",
  );
  assertEqual(
    drag.at?.r,
    ORIGIN.r,
    "a pointer within HEX_HIT_R of a center targets that hex rather than none: r",
  );
});
