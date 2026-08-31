// modes/bottleneck-refuses-outside — a footprint reaching outside the zone is
// refused, and builds nothing.
//
// THE RULE. specs/modes.md, Bottleneck: "Every tile of a footprint must lie inside
// that zone, so a footprint with a single tile outside it is invalid and builds
// nothing." specs/building.md states it as the fifth of the six conditions a held
// footprint must satisfy: "If the mode fixes a build zone, every tile of the
// footprint lies inside it." A failing condition makes the preview `build.valid`
// false, and "Placing on an invalid footprint builds nothing, blocks nothing, and
// spends nothing".
//
// A SINGLE TILE OUTSIDE, AS NEARLY AS THE ROSTER ALLOWS. specs/towers.md's smallest
// footprint is `2x2`, so no footprint in the game can have exactly one tile outside
// a rectangular zone. The nearest thing is a footprint straddling one edge of it,
// and this one straddles the FAR edge: it is anchored on the zone's LAST buildable
// column, so its left half is inside and its right half is one column past the end.
//
// THE ANCHOR IS INSIDE THE ZONE, AND THAT IS THE WHOLE POINT OF THE ANCHORING. The
// rule is about EVERY tile of the footprint, so the wrong model worth catching is a
// build that tests the footprint's own tile — the top-left one the preview reports —
// and lets the rest of the block fall where it may. A footprint anchored outside the
// zone would be refused by that build as readily as by a conformant one, and this
// point would pass it. Anchored inside and reaching out, it is refused only by a
// build that checks the whole block. It catches the build that checks nothing at the
// same time, so nothing is given up by asking for the harder reading.
//
// IT ALSO READS THE FAR EDGE AS INCLUSIVE. specs/modes.md ends the zone at column
// `36`, "both ends included", so the anchor tile is the last buildable one and the
// tile beyond it is the first unbuildable one — the two columns this footprint
// straddles are exactly the pair the boundary runs between.
//
// EVERY OTHER CONDITION IS SATISFIED, so the refusal can only be the zone's. The
// footprint is on the grid; both tiles it covers inside the zone and both outside it
// are open floor with no tower on them; `startRun` leaves the floor clear of surge,
// so no unit's tile is under it; the purse is far above the Arc's build cost; and two
// tiles beside a wide-open floor come nowhere near sealing a route. The anchor also
// keeps clear of both straight corridors — rows `16..19` and columns `22..29`
// (specs/floor.md) — so nothing about the placement touches the mazing rule either.
//
// TWO READINGS, ONE PER CLAUSE. Reads invalid: the held preview's `valid`. Builds
// nothing: the roster is the length it was after `place` is called on it. The second
// is not implied by the first — a build that reports the preview correctly and then
// commits it anyway is exactly the defect worth catching — and `place` is the ACT,
// which "commits the held preview if `build.valid`, as a press does"
// (specs/instrumentation.md), so what is exercised is the game's own placement code.
//
// WHAT THIS POINT DOES NOT DECIDE. That a footprint wholly inside the zone is
// accepted is `modes.bottleneck-allows-inside`; a build that refuses everything fails
// there and passes here, and each item names its own defect.

import { afterEach, beforeEach, it } from "vitest";
import { BOTTLENECK_ZONE, TOWER_DEFS } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The mode this point is about. */
const MODE = "bottleneck";

/** The type held: the cheapest 2x2 emitter on the roster (specs/towers.md). */
const HELD = "arc";

/**
 * The refused footprint's top-left tile: the zone's LAST buildable column, on a row
 * well inside its band.
 *
 * Its `2x2` block covers columns `36` and `37` and rows `10` and `11`, so its anchor
 * tile and one other lie inside the zone and the two to their right lie one column
 * past its end. The rows keep the whole block clear of the left corridor (`16..19`)
 * and the columns clear of the top one (`22..29`).
 */
const REFUSED_COL = BOTTLENECK_ZONE.col1;
const REFUSED_ROW = 10;

/** Enough money that affordability is never what refuses anything here. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a footprint straddling the zone's edge, and builds nothing", async () => {
  startRun(h, MODE);
  h.debug.setMoney(PURSE);

  const before = h.snapshot().towers.length;
  h.debug.setArmed(HELD);
  h.debug.setPreview(REFUSED_COL, REFUSED_ROW);
  const preview = h.snapshot().build;

  h.debug.place();
  const after = h.snapshot();
  await h.advance(1);
  captureStill(h, "outside");

  assertNotNull(
    preview,
    `the build preview arming a ${HELD} holds (specs/building.md, Arming a type)`,
  );
  const held = preview as NonNullable<typeof preview>;
  assertEqual(
    held.col,
    REFUSED_COL,
    "posing: the column the held footprint was moved to (specs/instrumentation.md)",
  );
  assertEqual(
    held.row,
    REFUSED_ROW,
    "posing: the row the held footprint was moved to (specs/instrumentation.md)",
  );
  assertEqual(
    held.valid,
    false,
    `whether a ${TOWER_DEFS[HELD].size}x${TOWER_DEFS[HELD].size} ${HELD} ` +
      `anchored at (${REFUSED_COL}, ${REFUSED_ROW}) is placeable, two of its ` +
      `tiles lying past the zone's last buildable column ` +
      `${BOTTLENECK_ZONE.col1} (specs/modes.md, Bottleneck)`,
  );
  assertEqual(
    after.towers.length,
    before,
    "the towers on the floor after committing a footprint that reaches outside " +
      "the zone (specs/modes.md, Bottleneck)",
  );
});
