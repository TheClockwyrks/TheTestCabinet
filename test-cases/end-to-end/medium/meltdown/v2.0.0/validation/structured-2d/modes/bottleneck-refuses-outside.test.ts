// Meltdown — modes/bottleneck-refuses-outside: a footprint reaching outside the
// zone is invalid, and committing it builds nothing.
//
// THE RULE. `specs/modes.md`, Bottleneck: "Every tile of a footprint must lie
// inside that zone, so a footprint with a single tile outside it is invalid and
// builds nothing." `specs/building.md` says the same as its fifth validity
// condition — "If the mode fixes a build zone, every tile of the footprint lies
// inside it" — and fixes what an invalid commit does: "On an invalid footprint it
// builds nothing and spends nothing."
//
// THE FOOTPRINT REACHES OUT BY THE SMALLEST AMOUNT A FOOTPRINT CAN. The Arc's is
// `2x2` (`specs/towers.md`), and it is anchored one column left of the zone's
// first column, so exactly one of its two columns — half its tiles, the fewest an
// axis-aligned footprint can put across a straight edge — lies outside. A build
// that tests the footprint's CENTRE, or its anchor tile, or its containing
// rectangle's midpoint rather than every tile of it, accepts this footprint; a
// build that tests every tile refuses it.
//
// EVERY OTHER VALIDITY CONDITION IS SATISFIED, so the zone is the only thing that
// can refuse this footprint and the reading is about the zone alone. The anchor
// is on open floor well clear of all four openings; the run is posed empty, so no
// tile is blocked and no unit's centre is on one; the purse is far above the
// Arc's cost; the footprint is wholly on the grid; and the tiles it covers are on
// neither straight corridor, so the never-seal rule of `specs/mazing.md` has
// nothing to say about it. Its ROW range lies inside the zone, so the column is
// the one thing out of place.
//
// TWO READINGS, ONE REQUIREMENT: the preview reads invalid, and committing it
// builds nothing. `specs/building.md` makes `build.valid` the answer the player
// sees and `place` the act it governs, so a build that draws the refusal and
// commits anyway, or commits nothing while showing the footprint as placeable,
// fails on the reading it got wrong. Neither is a tolerance: both are exact.
//
// WHETHER A LEGAL FOOTPRINT IS ACCEPTED is `modes.bottleneck-allows-inside`. A
// build that refuses every footprint everywhere passes this point and fails that
// one, which is the right split: this point decides one direction only.

import { afterEach, beforeEach, it } from "vitest";
import { BOTTLENECK_ZONE } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  sizeOf,
  startRun,
  type BuildSnapshot,
  type Harness,
} from "../harness";

/** The mode this point reads, and the type held. */
const MODE = "bottleneck";
const HELD = "arc";

/**
 * The footprint's anchor: one column left of the zone's first column, on a row
 * well inside it.
 *
 * Row `10` is inside the zone's `8..27`, off the left corridor's rows `16..19`,
 * and its columns are off the top corridor's `22..29`, so nothing but the column
 * puts this footprint outside the zone.
 */
const ANCHOR = { col: BOTTLENECK_ZONE.col0 - 1, row: 10 } as const;

/** Enough money that affordability can never be what refuses the footprint. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a footprint whose column reaches outside the zone", async () => {
  startRun(h, MODE);
  h.debug.setMoney(PURSE);
  h.debug.setArmed(HELD);
  h.debug.setPreviewRotation(0);
  h.debug.setPreview(ANCHOR.col, ANCHOR.row);

  await h.advance(1);
  captureStill(h, "outside");

  const held = h.snapshot();
  assertEqual(held.mode, MODE, "precondition: the mode the run is posed on");
  assertNotNull(held.build, "precondition: the preview the scenario holds");

  const preview = held.build as BuildSnapshot;
  assertEqual(preview.col, ANCHOR.col, "precondition: the footprint's column");
  assertEqual(preview.row, ANCHOR.row, "precondition: the footprint's row");
  assertEqual(
    preview.valid,
    false,
    `whether a ${String(sizeOf(HELD))}x${String(sizeOf(HELD))} footprint ` +
      `anchored at column ${String(ANCHOR.col)}, one left of the zone's ` +
      `${String(BOTTLENECK_ZONE.col0)}, reads placeable`,
  );

  const before = h.snapshot().towers.length;
  h.debug.place();
  assertEqual(
    h.snapshot().towers.length,
    before,
    "the towers on the floor after committing a footprint outside the zone",
  );
});
