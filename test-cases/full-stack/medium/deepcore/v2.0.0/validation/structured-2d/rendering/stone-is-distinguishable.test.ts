// rendering/stone-is-distinguishable — a boulder is recognized before the drill
// is wasted on it.
//
// specs/overview.md: "An unbreakable boulder reads as a harder material than the
// rock around it, so a player sees that the drill will not break it."
// specs/world.md puts unbreakable stone inside the playable field rather than at
// its border, so a shaft that meets one has to jog past it, and a player who
// cannot see one coming spends fuel on a cell that never breaks. The
// specification fixes no palette, so separation is what a check can read, and
// the review item states the figure: at least an RGB distance of 30 between the
// boulder and the band rock around it.
//
// EVERY BAND STONE APPEARS IN. specs/world.md places none in the topsoil and a
// rising share from the top of the rockbed down, so the boulder is posed in each
// of the three bands a player meets one in, read each time against that band's
// own rock in the same frame.
//
// The miner is parked clear of the boulder with both faculties held, so nothing
// cuts at it while the frame is read: what a drill does against stone is the
// drilling checks' business, not this one's.
//
// THE PRODUCED FILES ARE STOOD UP for this reading, because specs/assets.md has
// both the band rock and the unbreakable stone come from produced tiles.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual } from "../assert";
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
  type Band,
  type Harness,
} from "../harness";

/** The review item's figure for "reads as a harder material": 30 of 441. */
const STONE_APART_MIN = 30;

/** The bands unbreakable stone is generated in: every one but the topsoil. */
const STONE_BANDS: readonly Band[] = ["rockbed", "deepstone", "coreshell"];

/** The column the boulder sits in, mid-mine so the camera holds it. */
const STONE_COL = 16;

/** How many columns to the side the plain rock is read from. */
const ROCK_OFFSET = 2;

/** How far to the side the miner waits, clear of the boulder. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ assets: true });
});

afterEach(() => {
  h?.dispose();
});

it("draws an unbreakable boulder clearly apart from its band's rock", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);
  const { coreRow } = h.snapshot();

  const apart = new Map<Band, number>();
  for (const [index, band] of STONE_BANDS.entries()) {
    const row = rowInBand(band, coreRow);
    fillBlock(
      h,
      {
        fromCol: STONE_COL - ROCK_OFFSET,
        toCol: STONE_COL + ROCK_OFFSET,
        fromRow: row - 1,
        toRow: row + 1,
      },
      "rock",
    );
    h.debug.setTile(STONE_COL, row, "stone");
    placeAt(h, minerXOn(STONE_COL - MINER_OFFSET), minerYOn(row));

    // Two frames, which is what puts the produced tiles in the build's hand.
    await h.advance(2);
    const snapshot = h.snapshot();
    const boulder = sampleCell(h, snapshot, STONE_COL, row);
    const rock = sampleCell(h, snapshot, STONE_COL + ROCK_OFFSET, row);
    if (index === 0) captureStill(h, "boulder");
    apart.set(band, colorDistance(boulder, rock));
  }

  for (const band of STONE_BANDS) {
    assertGreaterThanOrEqual(
      apart.get(band) as number,
      STONE_APART_MIN,
      `an unbreakable boulder against the ${band} rock around it, sampled at each cell's centre in the same frame`,
    );
  }
});
