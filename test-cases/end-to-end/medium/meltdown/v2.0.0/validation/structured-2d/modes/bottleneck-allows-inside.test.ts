// Meltdown — modes/bottleneck-allows-inside: a footprint wholly inside the zone
// is placeable, and the floor outside the zone stays walkable.
//
// THE RULE. `specs/modes.md`, Bottleneck: building is restricted to the zone, and
// "The floor outside the zone stays open for the surge to walk". A footprint
// wholly inside the zone therefore satisfies `specs/building.md`'s fifth validity
// condition — "If the mode fixes a build zone, every tile of the footprint lies
// inside it" — and, with the other five satisfied, is valid and commits.
//
// THE FOOTPRINT IS PLACED JUST INSIDE THE ZONE'S CORNER, one column right of the
// anchor `modes.bottleneck-refuses-outside` is refused at. That pairing is the
// point of the choice: the two footprints differ by a single column, so a build
// that refuses this one is refusing the zone rather than the geometry, and a
// build that accepts both has no zone at all. The row is `10` — inside the zone's
// `8..27`, off the left corridor's rows `16..19` — and the columns are off the
// top corridor's `22..29`, so the tower lengthens neither straight route and
// nothing but the mode's own rule decides the placement.
//
// THE SECOND READING IS THE FLOOR OUTSIDE, and it is why this point measures two
// runs. `specs/modes.md` opens with "Every mode plays the same game: the same
// floor, the same mazing and re-pathing", and Bottleneck adds only that the surge
// still walks outside the zone. So the two route lengths are read first on an
// empty Containment floor — the open floor every mode shares — and then again on
// the Bottleneck run once the tower is down, and the two must agree. A build that
// confused "may not be built on" with "may not be walked on" and closed the floor
// outside its zone lengthens or destroys both routes; a build whose zone is
// merely a drawing over an unchanged floor leaves them exactly as they were.
//
// COMPARING TWO RUNS OF THE SAME BUILD IS WHAT KEEPS THAT READING HONEST. The
// route lengths themselves are `mazing`'s figures, not this item's, so a build
// that routes badly in a consistent way still reads equal here and is graded on
// its routing where that is decided.
//
// EVERY OTHER VALIDITY CONDITION IS SATISFIED, so the placement rests on the zone
// alone: the run is posed empty, the purse is far above the Arc's cost, the
// footprint is wholly on the grid, and nothing about the never-seal rule of
// `specs/mazing.md` touches a tower off both corridors. None of the three
// readings carries a tolerance: a placement either happens or does not, and a
// route length is a figure the same floor produces twice.

import { afterEach, beforeEach, it } from "vitest";
import { BOTTLENECK_ZONE } from "../constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  startRun,
  type BuildSnapshot,
  type Harness,
} from "../harness";

/** The mode this point reads, and the type held. */
const MODE = "bottleneck";
const HELD = "arc";

/**
 * The footprint's anchor: the zone's first column, on a row well inside it.
 *
 * One column right of the anchor `modes.bottleneck-refuses-outside` is refused
 * at, so the two points differ by a single column and by nothing else.
 */
const ANCHOR = { col: BOTTLENECK_ZONE.col0, row: 10 } as const;

/** Enough money that affordability can never be what refuses the footprint. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("places a footprint inside the zone and leaves the floor outside walkable", async () => {
  // The open floor every mode shares, read on an empty Containment run.
  startRun(h, "containment");
  const open = h.snapshot().paths;

  startRun(h, MODE);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(HELD);
  h.debug.setPreviewRotation(0);
  h.debug.setPreview(ANCHOR.col, ANCHOR.row);

  const held = h.snapshot();
  assertEqual(held.mode, MODE, "precondition: the mode the run is posed on");
  assertNotNull(held.build, "precondition: the preview the scenario holds");

  const preview = held.build as BuildSnapshot;
  assertEqual(preview.col, ANCHOR.col, "precondition: the footprint's column");
  assertEqual(preview.row, ANCHOR.row, "precondition: the footprint's row");
  assertEqual(
    preview.valid,
    true,
    `whether a footprint wholly inside the zone, anchored at column ` +
      `${String(ANCHOR.col)} row ${String(ANCHOR.row)}, reads placeable`,
  );

  const before = h.snapshot().towers.length;
  h.debug.place();

  await h.advance(1);
  captureStill(h, "inside");

  const after = h.snapshot();
  assertEqual(
    after.towers.length,
    before + 1,
    "the towers on the floor after committing a footprint inside the zone",
  );
  assertEqual(
    after.paths.left.length,
    open.left.length,
    "the left vent's route on Bottleneck, against the open floor's",
  );
  assertEqual(
    after.paths.top.length,
    open.top.length,
    "the top vent's route on Bottleneck, against the open floor's",
  );
});
