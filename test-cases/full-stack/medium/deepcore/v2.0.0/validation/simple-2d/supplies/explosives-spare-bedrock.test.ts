// Deepcore — supplies/explosives-spare-bedrock: bedrock is never cleared by a blast.
//
// `specs/items.md`: "Bedrock, material nodes, and the Core are immune and are
// never cleared."
//
// THREE IMMUNITIES, THREE POINTS. Bedrock, a material node and the Core are
// separate kinds a build clears separately, so a build that spares the Core and
// blows a material node away must grade differently from one that spares none of
// them. The other two are `supplies/explosives-spare-material-nodes` and `supplies/explosives-spare-the-core`.
//
// THE SCENE IS THE CORE CHAMBER, so two of the three cells are the world's own
// rather than posed: `specs/world.md` puts the Core at `(CORE_COL, coreRow)` and
// makes every other cell of that row bedrock, and `specs/instrumentation.md` says
// `clearMine` leaves the chamber as it is. The miner stands on the Core, which
// puts its own cell one row above it, and a `5x5` Plastic Explosives block from
// there covers the Core, the chamber's bedrock two columns over, and a material
// node posed beside the miner.
//
// The cell this point is about is confirmed to be what it should be BEFORE the
// charge, and confirmed to lie inside the block the charge covers, so a reading
// afterwards is of a cell the blast really reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CORE_COL, PLASTIC_EXPLOSIVES_RADIUS } from "../constants";
import {
  captureReplay,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  standOn,
  type Harness,
} from "../harness";
import { AFTERMATH_FRAMES } from "./blast-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the chamber's bedrock standing in a blast", async () => {
  openScene(h);
  const coreRow = h.snapshot().coreRow;

  standOn(h, CORE_COL, coreRow);
  pinMiner(h);
  pinDrill(h);

  const posed = h.snapshot();
  const centre = { col: posed.miner.col, row: posed.miner.row };
  const cell = { col: CORE_COL + PLASTIC_EXPLOSIVES_RADIUS, row: coreRow };

  h.debug.setItemCount("plastic-explosives", 1);

  // The cell is what it should be before anything is set off.
  assertEqual(
    h.tileAt(cell.col, cell.row).kind,
    "bedrock",
    "the chamber's bedrock before the blast",
  );

  // And it lies inside the block the charge covers.
  assertEqual(
    Math.max(
      Math.abs(cell.col - centre.col),
      Math.abs(cell.row - centre.row),
    ) <= PLASTIC_EXPLOSIVES_RADIUS,
    true,
    `cell (${cell.col}, ${cell.row}) inside the block`,
  );

  await captureReplay(h, "immune", async () => {
    h.debug.useItem("plastic-explosives");
    await h.advance(AFTERMATH_FRAMES);
  });

  assertEqual(
    h.tileAt(cell.col, cell.row).kind,
    "bedrock",
    "the bedrock after the blast",
  );
});
