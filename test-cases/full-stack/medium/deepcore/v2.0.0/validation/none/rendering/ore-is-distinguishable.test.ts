// rendering/ore-is-distinguishable — an ore cell is drawn as a vein rather than
// as plain rock.
//
// specs/overview.md: "An ore vein stands out from the plain rock of its band."
// specs/assets.md draws it as a smear of mineral run through the dirt, spreading
// across much of the cell. The specification fixes no palette, so what a check
// reads is that the vein is DRAWN: the cell's picture changes when an ore is
// what is in it. How much it stands out is the presentation rating's, not this
// check's.
//
// EVERY ORE, IN ITS OWN BAND. The requirement is about ore against rock rather
// than about one chosen ore, so each of the thirteen the specification names is
// posed in turn, and each is posed at the depth its own draw curve peaks at
// (specs/mining.md), which is the band a player actually meets it in.
//
// THE READING is one cell, twice, for each ore. The cell is posed to the vein
// and its interior sampled, then posed back to that band's plain rock and
// sampled again — same cell, same camera, same neighbours, so the only
// difference between the two readings is the kind of the cell.
//
// The miner is parked clear of the vein with both faculties held, so nothing is
// banked and nothing is cut while the frames are read.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
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

/** The column the vein sits in, mid-mine so the camera holds it. */
const ORE_COL = 16;

/** How many columns of plain band rock are laid either side of the posed cell. */
const ROCK_MARGIN = 2;

/** How far to the side the miner waits, clear of the vein. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws every ore vein differently from the rock the same cell holds", async () => {
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
        fromCol: ORE_COL - ROCK_MARGIN,
        toCol: ORE_COL + ROCK_MARGIN,
        fromRow: row - 1,
        toRow: row + 1,
      },
      "rock",
    );
    await placeAt(h, minerXOn(ORE_COL - MINER_OFFSET), minerYOn(row));

    // The cell holding the vein ...
    await h.debug.setOreTile(ORE_COL, row, ore);
    await h.advance(2);
    const vein = await sampleCell(h, await h.snapshot(), ORE_COL, row);
    if (index === 0) await captureStill(h, "vein");

    // ... and the same cell holding plain rock instead.
    await h.debug.setTile(ORE_COL, row, "rock");
    await h.advance(2);
    const rock = await sampleCell(h, await h.snapshot(), ORE_COL, row);

    apart.set(ore, colorDistance(vein, rock));
  }

  for (const ore of ORE_IDS) {
    assertGreaterThan(
      apart.get(ore) as number,
      0,
      `one cell sampled at its centre with a ${ore} vein in it and with plain rock in it`,
    );
  }
});
