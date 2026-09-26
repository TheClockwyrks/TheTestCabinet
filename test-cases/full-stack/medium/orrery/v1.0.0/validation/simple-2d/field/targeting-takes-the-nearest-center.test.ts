// field/targeting-takes-the-nearest-center — the nearest center wins when two are
// in range.
//
// THE RULE. "The pointer targets the field hex whose center is NEAREST to the
// pointer position, provided that distance is at most `HEX_HIT_R` (`26`)"
// (`specs/field.md`, Targeting a hex). The hit radius is `HEX_HIT_R` (`26`) while
// two neighbouring centers are `HEX_PITCH` (`48`) apart, so the discs overlap:
// between two adjacent hexes there is a band where both are in range, and there
// the rule is decided by which is nearer rather than by which was in range.
//
// THE CONFIGURATION. On the straight line from `(0, 0)`'s computed center to
// `(1, 0)`'s, `23` from the first and therefore `25` from the second, since the
// two are `HEX_PITCH` (`48`) apart. Both are inside `HEX_HIT_R`, so a build that
// took the first in-range hex it found could answer either, and the check reads
// both distances and every other center's back off the specification's own
// formulas before asking the build anything.
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
import {
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertLessThan,
  fail,
} from "../assert";
import { HEX_HIT_R } from "../constants";
import {
  at,
  distance,
  fieldHexes,
  hexCenter,
  sameHex,
  traySlot,
  type Hex,
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

/** The farther of the two hexes in range: `(0, 0)`'s eastern neighbour. */
const EASTWARD: Hex = at(1, 0);

/** `23` from `(0, 0)` toward `(1, 0)`, and so `25` from `(1, 0)`. */
const BETWEEN: StagePoint = {
  x: hexCenter(ORIGIN).x + 23,
  y: hexCenter(ORIGIN).y,
};

/** A stage point no field hex center lies within `HEX_HIT_R` of. */
const OFF_EVERY_HEX: StagePoint = { x: 616, y: 8 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("targets the nearer of two hexes both inside HEX_HIT_R", async () => {
  assertCloseTo(
    distance(BETWEEN, hexCenter(ORIGIN)),
    23,
    6,
    "the point is 23 from the center of (0, 0)",
  );
  assertCloseTo(
    distance(BETWEEN, hexCenter(EASTWARD)),
    25,
    6,
    "the point is 25 from the center of (1, 0)",
  );
  assertLessThan(
    distance(BETWEEN, hexCenter(EASTWARD)),
    HEX_HIT_R,
    "(1, 0) is in range too, so the verdict is the nearest rather than the only one",
  );
  for (const hex of fieldHexes()) {
    if (sameHex(hex, ORIGIN) || sameHex(hex, EASTWARD)) continue;
    assertGreaterThan(
      distance(BETWEEN, hexCenter(hex)),
      HEX_HIT_R,
      `(${hex.q}, ${hex.r}) is out of range, so exactly two centers are in it`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, BETWEEN);
  await h.advance(1);
  await captureStill(h, "nearest");

  const drag = (await h.snapshot()).editor.drag;
  await moveTo(h, OFF_EVERY_HEX);
  await releasePointer(h);

  if (drag === null || drag.kind !== "place") {
    fail('a live place drag, reported as editor.drag with kind "place"', drag);
  }
  assertEqual(
    drag.at?.q,
    ORIGIN.q,
    "the nearer of the two in-range centers is (0, 0)'s: q",
  );
  assertEqual(
    drag.at?.r,
    ORIGIN.r,
    "the nearer of the two in-range centers is (0, 0)'s: r",
  );
});
