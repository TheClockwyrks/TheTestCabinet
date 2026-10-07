// Deepcore — supplies/dynamite-clears-3x3: Dynamite opens the block around the
// miner and nothing outside it.
//
// `specs/items.md`: Dynamite "Clears the `3x3` block of cells centered on the
// miner's cell", "a radius of `1`", and "Using one consumes one". So the miner
// stands in a pocket cut out of solid rock, the charge is used through the
// control `specs/instrumentation.md` names for it, and every cell of the block is
// read as open tunnel afterwards while the whole ring one cell further out is
// read as the rock it was.
//
// Both readings matter and they are the same requirement in the same direction:
// a blast that cleared too little and one that cleared too much are both a wrong
// radius. The block is centred on the cell the SNAPSHOT reports the miner in, so
// the check grades where the charge went off rather than where it assumed the
// miner was.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DYNAMITE_RADIUS } from "../constants";
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

afterEach(async () => {
  await h.dispose();
});

it("clears the 3 by 3 block around the miner and consumes one Dynamite", async () => {
  const centre = await openBlastScene(h);
  await h.debug.setItemCount("dynamite", HELD);

  await captureReplay(h, "blast", async () => {
    await h.debug.useItem("dynamite");
    await h.advance(AFTERMATH_FRAMES);
  });

  const cells = blockCells(centre, DYNAMITE_RADIUS);
  const inside = await readCells(h, cells);
  for (const [i, tile] of inside.entries()) {
    assertEqual(
      tile.kind,
      "tunnel",
      `cell (${cells[i].col}, ${cells[i].row}) inside the block`,
    );
  }

  const outside = ringCells(centre, DYNAMITE_RADIUS + 1);
  const ring = await readCells(h, outside);
  for (const [i, tile] of ring.entries()) {
    assertEqual(
      tile.kind,
      "rock",
      `cell (${outside[i].col}, ${outside[i].row}) outside the block`,
    );
  }

  assertEqual((await h.snapshot()).items.dynamite, HELD - 1, "Dynamite left");
});
