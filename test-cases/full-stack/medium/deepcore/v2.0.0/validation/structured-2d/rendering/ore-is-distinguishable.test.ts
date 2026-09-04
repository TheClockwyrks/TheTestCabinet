// rendering/ore-is-distinguishable — a vein is spotted rather than stumbled on.
//
// specs/overview.md: "An ore vein stands out from the plain rock of its band."
// specs/assets.md draws it as a smear of mineral run through the dirt, spreading
// across much of the cell. The specification fixes no palette, so separation is
// what a check can read, and the review item states the figure: an ore cell's
// sampled interior at least an RGB distance of 30 from plain rock of the same
// band.
//
// EVERY ORE, IN ITS OWN BAND. The requirement is about ore against rock rather
// than about one chosen ore, so each of the thirteen minerals the specification
// names is posed in turn, and each is posed at the depth its own draw curve peaks
// at (specs/mining.md), which is the band a player actually meets it in. Both
// samples come from the same frame and the same band, so the only difference
// between them is the kind of the cell.
//
// The miner is parked clear of the vein with both faculties held, so nothing is
// banked and nothing is cut while the frame is read.
//
// THE PRODUCED FILES ARE STOOD UP for this reading, because specs/assets.md draws
// a vein as a produced overlay laid over the band's produced tile: what a player
// has to spot is that pair, not a fallback.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import { MINERALS, ORE_MIN_ROW } from "../constants";
import {
  captureStill,
  colorDistance,
  createHarness,
  fillBlock,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  pinMiner,
  placeAt,
  rowAtFraction,
  sampleCell,
  type Harness,
  type Ore,
} from "../harness";

/** The review item's figure for "stands out": 30 of the 441 RGB spans. */
const ORE_APART_MIN = 30;

/** The column the vein sits in, mid-mine so the camera holds it. */
const ORE_COL = 16;

/** How many columns to the side the plain rock is read from. */
const ROCK_OFFSET = 2;

/** How far to the side the miner waits, clear of the vein and of the rock read. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws every ore vein clearly apart from the rock it sits in", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  const { coreRow } = h.snapshot();

  const apart = new Map<Ore, number>();
  for (const [index, mineral] of MINERALS.entries()) {
    const row = Math.max(ORE_MIN_ROW + 1, rowAtFraction(mineral.peak, coreRow));
    fillBlock(
      h,
      {
        fromCol: ORE_COL - ROCK_OFFSET,
        toCol: ORE_COL + ROCK_OFFSET,
        fromRow: row - 1,
        toRow: row + 1,
      },
      "rock",
    );
    h.debug.setOreTile(ORE_COL, row, mineral.id);
    placeAt(h, minerXOn(ORE_COL - MINER_OFFSET), minerYOn(row));

    // Two frames, which is what puts the produced tiles and overlays in hand.
    await h.advance(2);
    const snapshot = h.snapshot();
    const vein = sampleCell(h, snapshot, ORE_COL, row);
    const rock = sampleCell(h, snapshot, ORE_COL + ROCK_OFFSET, row);
    if (index === 0) captureStill(h, "vein");
    apart.set(mineral.id, colorDistance(vein, rock));
  }

  for (const mineral of MINERALS) {
    assertGreaterThanOrEqual(
      apart.get(mineral.id) as number,
      ORE_APART_MIN,
      `a ${mineral.id} vein against plain rock of the same band, sampled at each cell's centre in the same frame`,
    );
  }
});
