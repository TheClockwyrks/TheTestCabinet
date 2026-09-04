// Deepcore — supplies/using-none-is-a-no-op: a supply the miner holds none of
// does nothing at all.
//
// `specs/items.md`: "Using an item held zero of ... is a no-op: a note is shown
// and nothing is consumed."
//
// The scene is the one a Dynamite charge would visibly change — the miner in a
// pocket cut out of solid rock — with every supply count at zero. The charge is
// then used, and the block, the hull, the tank and the count are all read back as
// they stood. The rock is the reading that matters: a count that stays at zero
// proves nothing on its own, since a build that fired the effect and then floored
// the count at zero would show exactly the same number.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DYNAMITE_RADIUS } from "../../src/constants";
import {
  captureReplay,
  createHarness,
  stageItems,
  type Harness,
} from "../harness";
import {
  AFTERMATH_FRAMES,
  blockCells,
  openBlastScene,
  readCells,
} from "./blast-scene";

/** A tank and a hull part spent, so a change in either direction would show. */
const POSED_FUEL = 60;
const POSED_HULL = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("changes nothing when the supply used is not held", async () => {
  const centre = openBlastScene(h);
  stageItems(h, {});
  h.debug.setFuel(POSED_FUEL);
  h.debug.setHull(POSED_HULL);

  // Every cell of the block a charge would clear, except the miner's own, which
  // the scene opened to stand in.
  const cells = blockCells(centre, DYNAMITE_RADIUS).filter(
    (cell) => cell.col !== centre.col || cell.row !== centre.row,
  );

  const noop = await captureReplay(h, "noop", async () => {
    h.debug.useItem("dynamite");
    const after = h.snapshot();
    const block = readCells(h, cells);
    await h.advance(AFTERMATH_FRAMES);
    return { after, block };
  });

  for (const [i, tile] of noop.block.entries()) {
    assertEqual(
      tile.kind,
      "rock",
      `cell (${cells[i].col}, ${cells[i].row}) after using a charge held none of`,
    );
  }

  assertEqual(noop.after.items.dynamite, 0, "Dynamite held after the use");
  assertEqual(noop.after.miner.hull, POSED_HULL, "hull after the use");
  assertEqual(noop.after.miner.fuel, POSED_FUEL, "the tank after the use");
});
