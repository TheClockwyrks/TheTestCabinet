// Deepcore — supplies/explosives-spare-the-immune: bedrock, material nodes and
// the Core are never cleared.
//
// `specs/items.md`: "Bedrock, material nodes, and the Core are immune and are
// never cleared." `specs/rocket.md` says why it matters: "The two material nodes
// and the Core are immune to explosives, so a blast can never destroy the only
// source of a component."
//
// All three are posed inside a `5x5` Plastic Explosives block, the widest one the
// game has, and read back unchanged: the node still a material node holding its
// material, the Core still the Core, the bedrock still bedrock. The satchel is
// read too — an immune node that had been "cleared" into the satchel would leave
// the cell gone just the same, and the specification says the node survives, not
// that it is collected.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLASTIC_RADIUS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { AFTERMATH_FRAMES, openBlastScene } from "./blast-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves bedrock, a material node and the Core standing in a blast", async () => {
  const centre = await openBlastScene(h);
  const node = { col: centre.col + 1, row: centre.row };
  const core = { col: centre.col - 1, row: centre.row };
  const bedrock = { col: centre.col, row: centre.row - 1 };

  await h.debug.setMaterialTile(node.col, node.row, "resonite");
  await h.debug.setTile(core.col, core.row, "core");
  await h.debug.setTile(bedrock.col, bedrock.row, "bedrock");
  await h.debug.setItemCount("plastic-explosives", 1);

  // All three sit inside the block the charge covers.
  assertEqual(Math.abs(node.col - centre.col) <= PLASTIC_RADIUS, true);
  assertEqual(Math.abs(core.col - centre.col) <= PLASTIC_RADIUS, true);
  assertEqual(Math.abs(bedrock.row - centre.row) <= PLASTIC_RADIUS, true);

  await captureReplay(h, "immune", async () => {
    await h.debug.useItem("plastic-explosives");
    await h.advance(AFTERMATH_FRAMES);
  });

  const nodeTile = await h.tileAt(node.col, node.row);
  assertEqual(nodeTile.kind, "material", "the material node after the blast");
  assertEqual(nodeTile.material, "resonite", "the material it still holds");

  assertEqual(
    (await h.tileAt(core.col, core.row)).kind,
    "core",
    "the Core after the blast",
  );
  assertEqual(
    (await h.tileAt(bedrock.col, bedrock.row)).kind,
    "bedrock",
    "the bedrock after the blast",
  );

  const { satchel } = await h.snapshot();
  assertEqual(satchel.resonite, 0, "Resonite banked by the blast");
});
