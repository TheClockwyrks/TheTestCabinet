// towers/footprint-3x3 — a 3x3 tower blocks nine tiles.
//
// THE RULE. specs/towers.md: "A tower occupies a square footprint of 2x2, 3x3, or
// 4x4 tiles, anchored and measured as specs/floor.md states", and
// specs/instrumentation.md reports `col` and `row` as the footprint's TOP-LEFT tile.
// So a Bloom anchored at `(10, 10)` covers `(10..12, 10..12)`, and nine tiles of the
// grid are closed to anything else.
//
// THE BLOOM IS THE ONLY 3x3 ON THE ROSTER, so this is the one reading of a footprint
// whose side is odd: its centre falls at the centre of its middle tile rather than on
// a tile boundary, and its perimeter is three edge-tiles a face. A build that laid a
// 3x3 out as a 2x2 with a strip, or that anchored it by its middle tile rather than
// its top-left, refuses a differently-placed band of anchors and is named by which
// one.
//
// HOW "BLOCKS EXACTLY" IS ASKED. The surface carries no operation that asks whether
// a tile is open, and specs/building.md offers exactly one way to ask: `build.valid`,
// which is the game's own placement check, and whose second condition is that "every
// tile of the footprint is open". So a 2x2 preview — the finest instrument the roster
// has, there being no 1x1 tower — is swept over the window of anchors around the
// standing Bloom, and the anchors it is REFUSED at are compared against the anchors
// whose own two-by-two block overlaps `(10..12, 10..12)`. Those two sets agree only
// for a build that blocked exactly nine tiles in exactly that square: blocking too few
// refuses too few anchors, blocking a 4x4 refuses more, and blocking the right
// count in the wrong place refuses a differently-placed band. The window reaches one
// fully-clear anchor past the blocked band on every side, so both directions of the
// comparison are read.
//
// THE PURSE IS POSED ABOVE THE PROBE'S COST, because affordability is condition 4 of
// the same check and is another item's requirement. With the money clear, a refused
// anchor is a blocked tile.
//
// THE ANCHOR IS AWAY FROM EVERY OPENING AND FROM BOTH CORRIDORS, so no probe is
// refused by the never-seal rule of condition 6 rather than by a blocked tile.
//
// WHERE THE BLOOM MEASURES ITS RANGE FROM is not read here.
// `towers/footprint-2x2` reads the centre rule, on the smallest footprint, where a
// pair of marks equidistant from the anchor tile straddles the radius; and
// `combat/range-from-the-footprint-centre` decides it on the Lance, where the
// footprint's centre is a tile and a half from the anchor tile's. This item reads the
// tiles alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import {
  PROBE_SIZE,
  costOf,
  overlapsFootprint,
  probeAround,
  towerOf,
} from "./roster";

/** The tower read, and the size specs/towers.md gives it. */
const TOWER = "bloom";
const SIZE = 3;

/** The anchor the item names, clear of both vent-to-exhaust corridors. */
const AT = { col: 10, row: 10 };

/** The type every probe is taken with: the smallest footprint on the roster. */
const PROBE = "arc";

/** Money far above the probe's build cost, so no anchor is refused for it. */
const PURSE = 100 * costOf(PROBE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("blocks exactly the nine tiles a 3x3 footprint covers", async () => {
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
});
