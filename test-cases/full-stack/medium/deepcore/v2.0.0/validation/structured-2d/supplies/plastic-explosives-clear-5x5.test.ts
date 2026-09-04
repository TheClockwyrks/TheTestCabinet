// Deepcore — supplies/plastic-explosives-clear-5x5: Plastic Explosives open the
// wider block around the miner and nothing outside it.
//
// `specs/items.md`: Plastic Explosives "Clears the `5x5` block of cells centered
// on the miner's cell", "a radius of `2`", and "Using one consumes one". The
// miner stands in a pocket cut out of solid rock, the charge is used through the
// control `specs/instrumentation.md` names for it, and every cell of the block is
// read as open tunnel afterwards while the whole ring one cell further out is
// read as the rock it was.
//
// A blast that cleared too little and one that cleared too much are both a wrong
// radius, so both readings belong to this one requirement. The block is centred
// on the cell the SNAPSHOT reports the miner in.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLASTIC_EXPLOSIVES_RADIUS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import {
  AFTERMATH_FRAMES,
  blockCells,
  openBlastScene,
  readCells,
  ringCells,
} from "./blast-scene";

/** Held so the count can be read down by exactly one. */
const HELD = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears the 5 by 5 block around the miner and consumes one charge", async () => {
  const centre = openBlastScene(h);
  h.debug.setItemCount("plastic-explosives", HELD);

  await captureReplay(h, "blast", async () => {
    h.debug.useItem("plastic-explosives");
    await h.advance(AFTERMATH_FRAMES);
  });

  const cells = blockCells(centre, PLASTIC_EXPLOSIVES_RADIUS);
  const inside = readCells(h, cells);
  for (const [i, tile] of inside.entries()) {
    assertEqual(
      tile.kind,
      "tunnel",
      `cell (${cells[i].col}, ${cells[i].row}) inside the block`,
    );
  }

  const outside = ringCells(centre, PLASTIC_EXPLOSIVES_RADIUS + 1);
  const ring = readCells(h, outside);
  for (const [i, tile] of ring.entries()) {
    assertEqual(
      tile.kind,
      "rock",
      `cell (${outside[i].col}, ${outside[i].row}) outside the block`,
    );
  }

  assertEqual(
    h.snapshot().items["plastic-explosives"],
    HELD - 1,
    "Plastic Explosives left",
  );
});
