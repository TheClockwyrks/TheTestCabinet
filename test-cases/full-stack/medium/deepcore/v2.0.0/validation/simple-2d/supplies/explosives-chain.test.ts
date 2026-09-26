// Deepcore — supplies/explosives-chain: every pocket in the block goes off, not
// only the first.
//
// `specs/items.md`: "Detonations chain within the block." `specs/hazards.md`
// repeats it and fixes what each one costs, so the reading that separates a
// chain from a single detonation is the hull: three pockets inside one `5x5`
// Plastic Explosives block, all three within `GAS_BLAST_TILES` of the miner's
// centre, must cost the sum of the three detonations the depth curve gives.
//
// The cells are read as well, because a build that cleared all three but only
// billed one is a build that did not chain, and a build that billed three but
// left a pocket in the ground is a different failure again. The hull tier is
// raised only so three detonations at this depth are survivable.
//
// A point and a half of hull is allowed over the three, half a point each, which
// lets a build keep hull as a whole number and is far inside the eighty-odd
// points one detonation costs.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { gasDamageAt, HULL_TIERS } from "../constants";
import {
  captureReplay,
  createHarness,
  depthFraction,
  type Harness,
} from "../harness";
import {
  AFTERMATH_FRAMES,
  openBlastScene,
  readCells,
  ROCKBED_ROW,
} from "./blast-scene";

/** Enough hull for three rockbed detonations with room to spare. */
const HULL_TIER = 4;

/** Half a point of hull per detonation. */
const TOLERANCE = 1.5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("detonates every pocket in the block, at the sum of their damage", async () => {
  const centre = openBlastScene(h, ROCKBED_ROW);
  h.debug.setTier("hull", HULL_TIER);
  h.debug.setHull(HULL_TIERS[HULL_TIER - 1]);

  const pockets = [
    { col: centre.col - 1, row: centre.row },
    { col: centre.col + 1, row: centre.row },
    { col: centre.col, row: centre.row - 1 },
  ];
  for (const pocket of pockets) {
    h.debug.setTile(pocket.col, pocket.row, "gas");
  }
  h.debug.setItemCount("plastic-explosives", 1);

  const before = h.snapshot();
  const expected = pockets.reduce(
    (total, pocket) =>
      total + gasDamageAt(depthFraction(pocket.row, before.coreRow)),
    0,
  );

  await captureReplay(h, "chain", async () => {
    h.debug.useItem("plastic-explosives");
    await h.advance(AFTERMATH_FRAMES);
  });

  const cleared = readCells(h, pockets);
  for (const [i, tile] of cleared.entries()) {
    assertEqual(
      tile.kind,
      "tunnel",
      `pocket (${pockets[i].col}, ${pockets[i].row}) after the blast`,
    );
  }

  const after = h.snapshot();
  assertBetween(
    before.miner.hull - after.miner.hull,
    expected - TOLERANCE,
    expected + TOLERANCE,
    "hull three chained detonations cost",
  );
});
