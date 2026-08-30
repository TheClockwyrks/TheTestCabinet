// Deepcore — supplies/explosives-spare-the-immune: bedrock, material nodes and
// the Core are never cleared.
//
// `specs/items.md`: "Bedrock, material nodes, and the Core are immune and are
// never cleared." `specs/rocket.md` says why it matters: "The two material nodes
// and the Core are immune to explosives, so a blast can never destroy the only
// source of a component."
//
// The check is run IN THE CORE CHAMBER, so two of the three are the world's own
// rather than posed: `specs/world.md` puts the Core at `(CORE_COL, coreRow)` and
// makes every other cell of that row bedrock, and `specs/instrumentation.md` says
// `clearMine` leaves the chamber as it is. The miner stands on the Core, which
// puts its own cell one row above it, and a `5x5` Plastic Explosives block from
// there covers the Core, the chamber's bedrock two columns over, and a material
// node posed beside the miner.
//
// All three must read back unchanged: the node still a node holding its material,
// the Core still the Core, the bedrock still bedrock. The satchel is read too — a
// node "cleared" into the satchel would leave the cell gone just the same, and
// the specification says the node survives rather than that it is collected.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CORE_COL, PLASTIC_EXPLOSIVES_RADIUS } from "../../src/constants";
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

afterEach(() => {
  h?.dispose();
});

it("leaves bedrock, a material node and the Core standing in a blast", async () => {
  openScene(h);
  const opened = h.snapshot();
  const coreRow = opened.coreRow;

  standOn(h, CORE_COL, coreRow);
  pinMiner(h);
  pinDrill(h);

  const posed = h.snapshot();
  const centre = { col: posed.miner.col, row: posed.miner.row };

  const core = { col: CORE_COL, row: coreRow };
  const bedrock = { col: CORE_COL + PLASTIC_EXPLOSIVES_RADIUS, row: coreRow };
  const node = { col: centre.col + 1, row: centre.row };

  layMaterial(h, node.col, node.row, "resonite");
  h.debug.setItemCount("plastic-explosives", 1);

  // The chamber is the world's own: the Core where the specification puts it, and
  // bedrock either side of it.
  assertEqual(h.tileAt(core.col, core.row).kind, "core", "the Core cell");
  assertEqual(
    h.tileAt(bedrock.col, bedrock.row).kind,
    "bedrock",
    "the chamber's bedrock",
  );
  assertEqual(
    h.tileAt(node.col, node.row).kind,
    "material",
    "the posed material node",
  );

  // And all three lie inside the block the charge covers.
  for (const cell of [core, bedrock, node]) {
    assertEqual(
      Math.max(
        Math.abs(cell.col - centre.col),
        Math.abs(cell.row - centre.row),
      ) <= PLASTIC_EXPLOSIVES_RADIUS,
      true,
      `cell (${cell.col}, ${cell.row}) inside the block`,
    );
  }

  await captureReplay(h, "immune", async () => {
    h.debug.useItem("plastic-explosives");
    await h.advance(AFTERMATH_FRAMES);
  });

  const nodeTile = h.tileAt(node.col, node.row);
  assertEqual(nodeTile.kind, "material", "the material node after the blast");
  assertEqual(nodeTile.material, "resonite", "the material it still holds");

  assertEqual(
    h.tileAt(core.col, core.row).kind,
    "core",
    "the Core after the blast",
  );
  assertEqual(
    h.tileAt(bedrock.col, bedrock.row).kind,
    "bedrock",
    "the bedrock after the blast",
  );

  const { satchel } = h.snapshot();
  assertEqual(satchel.resonite, 0, "Resonite banked by the blast");
});
