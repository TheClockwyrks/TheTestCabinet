// towers/footprint-2x2 — a 2x2 tower blocks four tiles, and its centre is the
// footprint's centre.
//
// THE RULE. specs/towers.md: "A tower occupies a square footprint of 2x2, 3x3, or
// 4x4 tiles, anchored and measured as specs/floor.md states", and "Range is
// measured from the footprint's centre". specs/instrumentation.md reports `col` and
// `row` as the footprint's TOP-LEFT tile. So an Arc anchored at `(10, 10)` covers
// `(10..11, 10..11)` and measures from the point where those four tiles meet — half
// a tile east and half a tile south of the centre of the anchor tile.
//
// HOW "BLOCKS EXACTLY" IS ASKED. The surface carries no operation that asks whether
// a tile is open, and specs/building.md offers exactly one way to ask: `build.valid`,
// which is the game's own placement check, and whose second condition is that "every
// tile of the footprint is open". So a 2x2 preview — the finest instrument the roster
// has, there being no 1x1 tower — is swept over the window of anchors around the
// standing Arc, and the anchors it is REFUSED at are compared against the anchors
// whose own two-by-two block overlaps `(10..11, 10..11)`. Those two sets agree only
// for a build that blocked exactly the four tiles: a build that blocked three refuses
// too few anchors, one that blocked a 3x3 refuses too many, and one that blocked the
// wrong four refuses a differently-placed nine. The window reaches one fully-clear
// anchor past the blocked band on every side, so both directions of the comparison
// are read.
//
// THE PURSE IS POSED ABOVE THE PROBE'S COST, because affordability is condition 4 of
// the same check and is another item's requirement. With the money clear, a refused
// anchor is a blocked tile.
//
// THE ANCHOR IS AWAY FROM EVERY OPENING AND FROM BOTH CORRIDORS, so no probe is
// refused by the never-seal rule of condition 6 rather than by a blocked tile.
//
// WHERE THE CENTRE IS, AND WHY IT TAKES A RANGE READING. Nothing the snapshot
// reports names the point a tower measures from, so the only observable of the centre
// is what the tower can reach. The pair posed is the distinguishing one: both marks
// stand the SAME distance from the centre of the anchor TILE — one east of it and one
// west of it, on the horizontal line through the footprint's centre — so any build
// measuring from the anchor tile gives them an identical verdict whatever radius it
// uses, and fails. Measured from the footprint's centre they are `104.5` and `123.5`
// units out, straddling the Arc's `114`, so a conformant build acquires the east mark
// and refuses the west one.
//
// WHAT THAT PROBE DOES AND DOES NOT DEMAND OF THE RADIUS. It demands only that the
// radius lie within half a tile of the `114` specs/towers.md gives the Arc — the
// window in which the two marks straddle it — so a build whose range figure is merely
// wrong fails `towers/arc-stats`, where the radius is read at the resolution the
// specification states it at, rather than this item. What it demands exactly is that
// the centre be the footprint's.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { TILE } from "../constants";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import {
  PROBE_SIZE,
  anchorCentre,
  costOf,
  gunCentre,
  overlapsFootprint,
  probeAround,
  rangeUnitsOf,
  targetsPoint,
  towerOf,
} from "./roster";

/** The tower read, and the size specs/towers.md gives it. */
const TOWER = "arc";
const SIZE = 2;

/** The anchor the item names, clear of both vent-to-exhaust corridors. */
const AT = { col: 10, row: 10 };

/** The type every blocked-set probe is taken with: the smallest footprint. */
const PROBE = "arc";

/** Money far above the probe's build cost, so no anchor is refused for it. */
const PURSE = 100 * costOf(PROBE);

/** The Arc's radius, in logical units: 6.0 tiles of 19 (specs/towers.md). */
const RADIUS_UNITS = rangeUnitsOf(TOWER);

/**
 * How far east and west of the ANCHOR TILE's centre each range mark stands, in
 * logical units.
 *
 * Geometry, not a tolerance. The footprint's centre sits `9.5` units east and south
 * of the anchor tile's centre, so a mark `114` units east of that centre is `104.5`
 * from the footprint's centre and one `114` west is `123.5` — straddling the `114`
 * radius while staying equidistant from the anchor tile. Any offset between `104.5`
 * and `123.5` does the same; `114` is the middle of that window.
 */
const OFFSET_UNITS = 114;

/**
 * How far the footprint's centre lies from the anchor tile's centre, on each axis:
 * `(size - 1) / 2` tiles, which is `9.5` units for a 2x2.
 */
const CENTRE_OFFSET = ((SIZE - 1) * TILE) / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blocks exactly four tiles, and measures from where they meet", async () => {
  // ---- The footprint the snapshot reports ---------------------------------
  startRun(h);
  h.debug.setMoney(PURSE);
  const id = poseTower(h, TOWER, AT.col, AT.row);

  const standing = towerOf(h.snapshot(), id);
  assertEqual(standing.size, SIZE, `the ${TOWER}'s footprint side, in tiles`);
  assertEqual(
    standing.col,
    AT.col,
    "the column of the footprint's top-left tile (specs/instrumentation.md)",
  );
  assertEqual(
    standing.row,
    AT.row,
    "the row of the footprint's top-left tile (specs/instrumentation.md)",
  );

  // ---- Which tiles it blocked, asked through the placement check -----------
  const probed = probeAround(h, PROBE, AT.col, AT.row, SIZE);
  const refused = probed
    .filter((probe) => !probe.valid)
    .map((probe) => `${probe.col},${probe.row}`);
  const expected = probed
    .filter((probe) => overlapsFootprint(probe, AT.col, AT.row, SIZE))
    .map((probe) => `${probe.col},${probe.row}`);

  h.debug.setArmed(null);
  h.debug.setSelected(id);
  await h.advance(1);
  captureStill(h, "footprint");

  assertDeepEqual(
    refused,
    expected,
    `the anchors a ${PROBE_SIZE}x${PROBE_SIZE} preview is refused at around a ` +
      `${TOWER} anchored at (${AT.col}, ${AT.row}), which are exactly those ` +
      `overlapping (${AT.col}..${AT.col + SIZE - 1}, ${AT.row}..` +
      `${AT.row + SIZE - 1}) (specs/building.md, Valid and invalid)`,
  );

  // ---- Where it measures from ---------------------------------------------
  const centre = gunCentre(TOWER, AT);
  const anchor = anchorCentre(AT);
  const east = { x: anchor.x + OFFSET_UNITS, y: centre.y };
  const west = { x: anchor.x - OFFSET_UNITS, y: centre.y };

  assertEqual(
    await targetsPoint(h, TOWER, east, AT),
    true,
    `a mark ${OFFSET_UNITS - CENTRE_OFFSET} units from the footprint centre ` +
      `acquired, inside the ${TOWER}'s ${RADIUS_UNITS} — the same distance ` +
      `from the anchor tile as the west mark`,
  );
  assertEqual(
    await targetsPoint(h, TOWER, west, AT),
    false,
    `a mark ${OFFSET_UNITS + CENTRE_OFFSET} units from the footprint centre ` +
      `refused, beyond the ${TOWER}'s ${RADIUS_UNITS} — the same distance ` +
      `from the anchor tile as the east mark`,
  );
});
