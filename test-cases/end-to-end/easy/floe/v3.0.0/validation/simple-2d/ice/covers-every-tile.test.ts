// ice/covers-every-tile — every tile a vehicle spans is closed, the middle one
// included.
//
// specs/ice.md: "A lane item is a span rather than a point. Its reported `x` is
// its left edge and its length `len` is in tiles, so it occupies
// `[x, x + TILE * len)` on its own row", it covers a tile of its row when "that
// tile's center is covered", and "Every tile a vehicle covers is closed to the
// critter: a hop onto it is refused". specs/hopping.md lists that refusal among
// the five it fixes, and fixes what one leaves behind: "the critter stays where
// it stands".
//
// THE MIDDLE TILE IS THE WHOLE POINT. A build that tested a hop's target against
// a vehicle's two EDGES rather than against its span closes the first and third
// tile of a plow and leaves the second open — a hole the critter can hop into
// and stand inside a moving plow. A three-tile plow is the shortest span that
// has a middle at all, which is why the item names one, and the three hops below
// are taken one per tile so a failed grade names which tile stayed open.
//
// THE PLOW IS PARKED, at a lane speed of `0`, so nothing here turns on the
// crush: specs/ice.md leaves a critter under a stopped vehicle "as it stands",
// and `ice/crush-kills` and `ice/crush-only-on-arrival` grade what a moving one
// does. The refusal is the whole of what this check reads.
//
// A CONTROL HOP FIRST, into the same row at a column the plow does not span. A
// refusal only means something against a hop that would otherwise be taken, and
// without it a build whose critter cannot hop up at all would pass this item by
// standing still three times.

import { afterEach, beforeEach, it } from "vitest";
import { tileLeft } from "../constants";
import { assertDeepEqual, assertTrue } from "../assert";
import {
  captureReplay,
  coversTile,
  createHarness,
  critterTile,
  hop,
  lastVehicle,
  poseLane,
  startCrossing,
  type Harness,
  type Tile,
} from "../harness";

/** The level the crossing is posed at. The covering rule is the same at each. */
const LEVEL = 1;

/** The lane the plow is parked on: row 17, which the lane table gives a plow. */
const PLOW_ROW = 17;

/** The row the critter hops up FROM: the ice row below, left empty of traffic. */
const STAND_ROW = PLOW_ROW + 1;

/** The leftmost column the parked plow spans. Mid-strait, clear of both edges. */
const SPAN_COL = 20;

/** The three columns a three-tile plow parked there spans. */
const SPANNED = [SPAN_COL, SPAN_COL + 1, SPAN_COL + 2];

/** A column of the same row the plow does not reach, for the control hop. */
const CLEAR_COL = SPAN_COL - 2;

/** One hop of the three: where the critter stood, and where it stood after. */
interface Refusal {
  col: number;
  before: Tile;
  after: Tile;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("refuses a hop into each of the three tiles a parked plow spans", async () => {
  startCrossing(h, LEVEL);
  poseLane(h, PLOW_ROW, "plow", [SPAN_COL]);

  // The scenario this check needs: a plow parked over exactly those three tiles,
  // and nothing over the column the control hop goes to.
  const parked = lastVehicle(h.snapshot());
  assertTrue(
    SPANNED.every((col) => coversTile(parked, col)) &&
      !coversTile(parked, CLEAR_COL),
    `a plow parked at x ${tileLeft(SPAN_COL)} on row ${PLOW_ROW}, covering ` +
      `columns ${SPANNED.join(", ")} and not column ${CLEAR_COL} ` +
      `(specs/ice.md), was ${JSON.stringify(parked)}`,
  );

  // The control: the same hop into the same row, at a column the plow leaves
  // open. Outside the recording, which is the three refusals.
  h.debug.setCritterTile(CLEAR_COL, STAND_ROW);
  await hop(h, "up");
  assertDeepEqual(
    critterTile(h.snapshot()),
    { col: CLEAR_COL, row: PLOW_ROW },
    `a hop up from column ${CLEAR_COL}, which no vehicle covers, is taken ` +
      "(specs/hopping.md) — a refusal grades nothing without it",
  );

  const refusals: Refusal[] = [];
  await captureReplay(h, "refuse", async () => {
    for (const col of SPANNED) {
      h.debug.setCritterTile(col, STAND_ROW);
      const before = critterTile(h.snapshot());
      await hop(h, "up");
      refusals.push({ col, before, after: critterTile(h.snapshot()) });
    }
  });

  for (const refusal of refusals) {
    assertDeepEqual(
      refusal.after,
      refusal.before,
      `the hop up into column ${refusal.col} of row ${PLOW_ROW}, which the ` +
        "parked plow spans, leaves the critter where it stood",
    );
  }
});
