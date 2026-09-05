// rendering/lava-is-distinguishable — a lava cell is drawn as lava rather than
// as more rock.
//
// specs/overview.md: "Lava is plainly visible as molten and dangerous against
// safe ground." A pool has to be read BEFORE the miner is standing in it, and
// specs/hazards.md makes contact cost hull continuously, so a lava cell drawn
// exactly as rock is a lava cell a player drills into. The specification fixes
// no palette, so what a check reads is that the lava is DRAWN: the cell's
// picture changes when lava is what is in it. How molten it looks is the
// presentation rating's, not this check's.
//
// THE READING is one cell, twice. A run of the band's rock is laid, the cell in
// the middle of it is posed to lava and its interior sampled, then the same cell
// is posed back to that band's rock and sampled again — same cell, same camera,
// same neighbours, so the only difference between the two readings is the kind
// of the cell. The deepstone is the band used, because specs/world.md puts the
// shallowest lava there.
//
// The miner is parked clear of the pool with both faculties held, so it neither
// walks into the lava nor drills it while the frames are read — the contact
// drain and the drilling lump belong to the hazards checks, not to this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
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

/** The column the pool sits in, mid-mine so the camera holds it. */
const LAVA_COL = 16;

/** How many columns of plain band rock are laid either side of the posed cell. */
const ROCK_MARGIN = 2;

/** How far to the side the miner waits, clear of the pool. */
const MINER_OFFSET = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws a lava cell differently from the rock the same cell holds", async () => {
  openScene(h);
  pinMiner(h);
  pinDrill(h);

  const row = rowInBand("deepstone", h.snapshot().coreRow);
  fillBlock(
    h,
    {
      fromCol: LAVA_COL - ROCK_MARGIN,
      toCol: LAVA_COL + ROCK_MARGIN,
      fromRow: row - 1,
      toRow: row + 1,
    },
    "rock",
  );
  placeAt(h, minerXOn(LAVA_COL - MINER_OFFSET), minerYOn(row));

  // The cell holding lava ...
  h.debug.setTile(LAVA_COL, row, "lava");
  await h.advance(2);
  const lava = sampleCell(h, h.snapshot(), LAVA_COL, row);
  captureStill(h, "lava");

  // ... and the same cell holding the band's rock instead.
  h.debug.setTile(LAVA_COL, row, "rock");
  await h.advance(2);
  const rock = sampleCell(h, h.snapshot(), LAVA_COL, row);

  assertGreaterThan(
    colorDistance(lava, rock),
    0,
    "one cell sampled at its centre with lava in it and with rock in it",
  );
});
