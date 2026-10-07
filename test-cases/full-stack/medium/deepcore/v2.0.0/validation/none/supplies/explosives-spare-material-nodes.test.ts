// Deepcore — supplies/explosives-spare-material-nodes: a material node is never cleared by a blast.
//
// `specs/items.md`: "Bedrock, material nodes, and the Core are immune and are
// never cleared." `specs/rocket.md` says why it matters: "The two
// material nodes and the Core are immune to explosives, so a blast can never
// destroy the only source of a component."
//
// THREE IMMUNITIES, THREE POINTS. Bedrock, a material node and the Core are
// separate kinds a build clears separately, so a build that spares the Core and
// blows a material node away must grade differently from one that spares none of
// them. The other two are `supplies/explosives-spare-bedrock` and `supplies/explosives-spare-the-core`.
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
import { CORE_COL, PLASTIC_RADIUS } from "../constants";
import {
  captureReplay,
  createHarness,
  layMaterial,
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

afterEach(async () => {
  await h.dispose();
});

it("leaves a material node standing in a blast", async () => {
  await openScene(h);
  const coreRow = (await h.snapshot()).coreRow;

  await standOn(h, CORE_COL, coreRow);
  await pinMiner(h);
  await pinDrill(h);

  const posed = await h.snapshot();
  const centre = { col: posed.miner.col, row: posed.miner.row };
  const cell = { col: centre.col + 1, row: centre.row };

  await layMaterial(h, cell.col, cell.row, "resonite");
  await h.debug.setItemCount("plastic-explosives", 1);

  // The cell is what it should be before anything is set off.
  assertEqual(
    (await h.tileAt(cell.col, cell.row)).kind,
    "material",
    "the posed material node before the blast",
  );

  // And it lies inside the block the charge covers.
  assertEqual(
    Math.max(
      Math.abs(cell.col - centre.col),
      Math.abs(cell.row - centre.row),
    ) <= PLASTIC_RADIUS,
    true,
    `cell (${cell.col}, ${cell.row}) inside the block`,
  );

  await captureReplay(h, "immune", async () => {
    await h.debug.useItem("plastic-explosives");
    await h.advance(AFTERMATH_FRAMES);
  });

  const nodeTile = await h.tileAt(cell.col, cell.row);
  assertEqual(nodeTile.kind, "material", "the material node after the blast");
  assertEqual(nodeTile.material, "resonite", "the material it still holds");

  // The satchel too: a node "cleared" into it would leave the cell gone just the
  // same, and the specification says the node SURVIVES rather than that it is
  // collected.
  assertEqual(
    (await h.snapshot()).satchel.resonite,
    0,
    "Resonite banked by the blast",
  );
});
