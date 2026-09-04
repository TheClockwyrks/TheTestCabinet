// field/targeting-ties-break-on-smaller-q — a tie of equal r goes to the smaller
// q.
//
// THE RULE. "When two or more centers are equidistant, the hex with the smaller
// `r` wins, then the smaller `q`" (`specs/field.md`, Targeting a hex). The
// tiebreak is stated in two parts, and the second part only decides anything when
// the first cannot: two hexes of equal `r`. That is exactly the pair `(0, 0)` and
// `(1, 0)`, both on row `0`.
//
// THE CONFIGURATION. The midpoint of the straight line between `(0, 0)`'s
// computed center and `(1, 0)`'s, which is `HEX_PITCH / 2` (`24.00`) from each,
// since the two are `HEX_PITCH` (`48`) apart. Both are inside `HEX_HIT_R` (`26`),
// neither is nearer, and their `r` is the same — so nothing but the `q` rule can
// settle it. The check reads both distances and every other center's back off the
// specification's own formulas before asking the build anything.
//
// WHAT IS READ. A live place drag reports its target: "a press begins it, each
// pointer move retargets it" (`specs/editor.md`, Dragging), carried in the
// snapshot as `editor.drag` with "`at`: the targeted hex, `null` off every hex"
// (`specs/instrumentation.md`). Nothing is placed and nothing is committed.
//
// A TIE IS A TIE IN EXACT ARITHMETIC. `hexX` is `FIELD_CX + HEX_PITCH * (q +
// r / 2)`, so on row `0` the two centers are whole numbers `HEX_PITCH` apart and
// their midpoint is a whole number too: the two distances are equal in a double
// rather than equal to within a rounding, and the tiebreak really is what decides.
//
// THE WORLD IS POSED, NOT SEARCHED. `BARE` is loaded as a challenge document and
// the machine emptied, so no part is on the field to take the press instead, and
// there is no live run, which would reduce a press on the field to a focus
// change. The drag is released off every hex, which "places nothing".

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan, fail } from "../assert";
import { HEX_HIT_R, HEX_PITCH } from "../constants";
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

/** The other hex of the tie: same `r`, larger `q`. */
const EASTWARD: Hex = at(1, 0);

/** The midpoint between the two centers, `HEX_PITCH / 2` from each. */
const TIE: StagePoint = {
  x: (hexCenter(ORIGIN).x + hexCenter(EASTWARD).x) / 2,
  y: (hexCenter(ORIGIN).y + hexCenter(EASTWARD).y) / 2,
};

/** A stage point no field hex center lies within `HEX_HIT_R` of. */
const OFF_EVERY_HEX: StagePoint = { x: 616, y: 8 };

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the smaller q when two hexes of equal r are equidistant", async () => {
  assertEqual(
    distance(TIE, hexCenter(ORIGIN)),
    distance(TIE, hexCenter(EASTWARD)),
    "the two centers are equidistant from the midpoint between them",
  );
  assertCloseTo(
    distance(TIE, hexCenter(ORIGIN)),
    HEX_PITCH / 2,
    6,
    "each center is HEX_PITCH / 2 from the midpoint",
  );
  assertEqual(
    ORIGIN.r,
    EASTWARD.r,
    "the two hexes share a row, so the smaller-r rule cannot settle the tie",
  );
  for (const hex of fieldHexes()) {
    if (sameHex(hex, ORIGIN) || sameHex(hex, EASTWARD)) continue;
    assertGreaterThan(
      distance(TIE, hexCenter(hex)),
      HEX_HIT_R,
      `(${hex.q}, ${hex.r}) is out of range, so exactly two centers are tied`,
    );
  }

  await openChallengeDocument(h, BARE);
  await h.debug.clearMachine();

  await pressAt(h, centerOf(traySlot(0)));
  await moveTo(h, TIE);
  await h.advance(1);
  await captureStill(h, "tie-q");

  const drag = (await h.snapshot()).editor.drag;
  await moveTo(h, OFF_EVERY_HEX);
  await releasePointer(h);

  if (drag === null || drag.kind !== "place") {
    fail('a live place drag, reported as editor.drag with kind "place"', drag);
  }
  assertEqual(
    drag.at?.q,
    ORIGIN.q,
    "a tie the r rule cannot settle goes to the smaller q: q",
  );
  assertEqual(
    drag.at?.r,
    ORIGIN.r,
    "a tie the r rule cannot settle goes to the smaller q: r",
  );
});
