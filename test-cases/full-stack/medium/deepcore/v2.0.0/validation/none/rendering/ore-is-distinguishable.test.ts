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
// than about one chosen ore, so each of the thirteen the specification names is
// posed in turn, and each is posed at the depth its own draw curve peaks at
// (specs/mining.md), which is the band a player actually meets it in. Both
// samples come from the same frame and the same band, so the only difference
// between them is the kind of the cell.
//
// The miner is parked clear of the vein with both faculties held, so nothing is
// banked and nothing is cut while the frame is read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
import {
  ORES,
  ORE_IDS,
  ORE_MIN_ROW,
  rowAtFraction,
  type Ore,
} from "../constants";
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
  sampleCell,
  type Harness,
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
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every ore vein clearly apart from the rock it sits in", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  const { coreRow } = await h.snapshot();

  const apart = new Map<Ore, number>();
  for (const [index, ore] of ORE_IDS.entries()) {
    const row = Math.max(
      ORE_MIN_ROW + 1,
      rowAtFraction(ORES[ore].peak, coreRow),
    );
    await fillBlock(
      h,
      {
        fromCol: ORE_COL - ROCK_OFFSET,
        toCol: ORE_COL + ROCK_OFFSET,
        fromRow: row - 1,
        toRow: row + 1,
      },
      "rock",
    );
    await h.debug.setOreTile(ORE_COL, row, ore);
    await placeAt(h, minerXOn(ORE_COL - MINER_OFFSET), minerYOn(row));

    await h.advance(1);
    const snapshot = await h.snapshot();
    const vein = await sampleCell(h, snapshot, ORE_COL, row);
    const rock = await sampleCell(h, snapshot, ORE_COL + ROCK_OFFSET, row);
    if (index === 0) await captureStill(h, "vein");
    apart.set(ore, colorDistance(vein, rock));
  }

  for (const ore of ORE_IDS) {
    assertGreaterThanOrEqual(
      apart.get(ore) as number,
      ORE_APART_MIN,
      `a ${ore} vein against plain rock of the same band, sampled at each cell's centre in the same frame`,
    );
  }
});
