// rendering/stone-is-distinguishable — an unbreakable boulder is drawn as a
// boulder rather than as more rock.
//
// specs/overview.md: "An unbreakable boulder reads as a harder material than the
// rock around it, so a player sees that the drill will not break it."
// specs/world.md puts unbreakable stone inside the playable field rather than at
// its border, so a shaft that meets one has to jog past it. The specification
// fixes no palette, so what a check reads is that the boulder is DRAWN: the
// cell's picture changes when stone is what is in it. How much harder it looks
// is the presentation rating's, not this check's.
//
// EVERY BAND STONE APPEARS IN. specs/world.md places none in the topsoil and a
// rising share from the top of the rockbed down, so the boulder is posed in each
// of the three bands a player meets one in.
//
// THE READING is one cell, twice, in each band. The cell is posed to stone and
// its interior sampled, then posed back to that band's rock and sampled again —
// same cell, same camera, same neighbours, so the only difference between the
// two readings is the kind of the cell.
//
// The miner is parked clear of the boulder with both faculties held, so nothing
// cuts at it while the frames are read: what a drill does against stone is the
// drilling checks' business, not this one's.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import type { Band } from "../constants";
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
  rowInBand,
  sampleCell,
  type Harness,
} from "../harness";

/** The bands unbreakable stone is generated in: every one but the topsoil. */
const STONE_BANDS: readonly Band[] = ["rockbed", "deepstone", "coreshell"];

/** The column the boulder sits in, mid-mine so the camera holds it. */
const STONE_COL = 16;

/** How many columns of plain band rock are laid either side of the posed cell. */
const ROCK_MARGIN = 2;

/** How far to the side the miner waits, clear of the boulder. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a boulder differently from the rock the same cell holds", async () => {
  await openScene(h);
  await pinMiner(h);
  await pinDrill(h);
  const { coreRow } = await h.snapshot();

  const apart = new Map<Band, number>();
  for (const [index, band] of STONE_BANDS.entries()) {
    const row = rowInBand(band, coreRow);
    await fillBlock(
      h,
      {
        fromCol: STONE_COL - ROCK_MARGIN,
        toCol: STONE_COL + ROCK_MARGIN,
        fromRow: row - 1,
        toRow: row + 1,
      },
      "rock",
    );
    await placeAt(h, minerXOn(STONE_COL - MINER_OFFSET), minerYOn(row));

    // The cell holding the boulder ...
    await h.debug.setTile(STONE_COL, row, "stone");
    await h.advance(2);
    const boulder = await sampleCell(h, await h.snapshot(), STONE_COL, row);
    if (index === 0) await captureStill(h, "boulder");

    // ... and the same cell holding the band's rock instead.
    await h.debug.setTile(STONE_COL, row, "rock");
    await h.advance(2);
    const rock = await sampleCell(h, await h.snapshot(), STONE_COL, row);

    apart.set(band, colorDistance(boulder, rock));
  }

  for (const band of STONE_BANDS) {
    assertGreaterThan(
      apart.get(band) as number,
      0,
      `one cell sampled at its centre with a boulder in it and with ${band} rock in it`,
    );
  }
});
