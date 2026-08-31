// floor/left-vent-rows — the left vent opens on rows 16 to 19, and on no other
// row.
//
// THE RULE. specs/floor.md cuts the left vent into the casing's left edge over
// the run `LEFT_VENT_ROWS`, tiles `(0, 16)` through `(0, 19)`, and specs/surge.md
// states where a unit arriving there appears: "Its centre appears on the centre
// of an open opening tile of that vent". So a unit added at the left vent stands
// on one of those four tiles and on no other, whatever its type.
//
// WHY THE READING IS TAKEN TWICE, FROM TWO PLACES IN THE SNAPSHOT. `col` and
// `row` are what the build says the unit stands on; `x` and `y` are where the
// build put it. specs/floor.md fixes the map between them, so both readings have
// to name a vent tile: a build that reports the right tile but placed the unit
// somewhere else, and one that placed it correctly but reports the wrong tile,
// are different defects and both are this item's. The tile is read back through
// this suite's own `tileAtPoint`, which is specs/floor.md's inverse map computed
// beside the build rather than asked of it.
//
// WHY NOTHING IS DRIVEN BEFORE THE READING. The requirement is about the moment
// of ENTRY, so every assertion is read off the snapshot taken before a single
// frame runs, and motion is switched off before the one frame the evidence still
// needs — the faculty this item exercises is arriving, not walking, which
// specs/mazing.md owns. A frame of walking would carry a Sprint a unit across the
// tile it entered on and prove nothing either way.
//
// WHY MANY UNITS. Nothing in the specification fixes WHICH of the four tiles a
// unit takes, so a build is free to pick any of them however it likes. Four
// arrivals of each of the six types is enough that a build picking a fifth row
// occasionally is caught, and each failure names the type and the draw it came
// from.

import { afterEach, beforeEach, it } from "vitest";
import { LEFT_VENT_ROWS, SURGE_TYPES } from "../../src/constants";
import { assertContains, assertEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  tileAtPoint,
  type Harness,
} from "../harness";

/** Arrivals of each of the six types, so one wrong row in a batch is caught. */
const DRAWS_PER_TYPE = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("enters every unit on one of the left vent's four rows", async () => {
  startRun(h);

  for (const type of SURGE_TYPES) {
    for (let draw = 0; draw < DRAWS_PER_TYPE; draw += 1) {
      h.debug.addUnit(type, "left");
    }
  }

  const posed = h.snapshot();
  // Held still for the evidence frame: the entry is what is under test, so the
  // picture shows where each unit arrived rather than where a frame of walking
  // carried it.
  for (const unit of posed.surge) h.debug.setUnitMotion(unit.id, false);
  await h.advance(1);
  captureStill(h, "vent");

  assertLength(
    posed.surge,
    SURGE_TYPES.length * DRAWS_PER_TYPE,
    "the units the vent admitted",
  );

  for (const [index, unit] of posed.surge.entries()) {
    const at = `${unit.type} #${index + 1}`;
    assertEqual(unit.vent, "left", `${at}: the vent it entered at`);
    // What the build says the unit stands on.
    assertEqual(unit.col, 0, `${at}: the column of the tile it entered on`);
    assertContains(
      LEFT_VENT_ROWS,
      unit.row,
      `${at}: the row of the tile it entered on`,
    );
    // And where the build actually put it, read through the map of
    // specs/floor.md rather than through the build's own arithmetic.
    const fell = tileAtPoint(unit.x, unit.y);
    assertEqual(
      fell.col,
      0,
      `${at}: the column its centre x=${unit.x} falls in`,
    );
    assertContains(
      LEFT_VENT_ROWS,
      fell.row,
      `${at}: the row its centre y=${unit.y} falls in`,
    );
  }
});
