// Deepcore — supplies/explosives-destroy-ore: ore caught in a blast is lost.
//
// `specs/items.md`: "Ore and gemstones in the block are destroyed rather than
// collected." `specs/mining.md` states the same rule from the other side: "Ore is
// collected only by drilling. An ore cell caught in an explosives blast clears to
// tunnel like any other cell and its ore is lost."
//
// An ore vein and a gemstone are posed inside the `3x3` Dynamite block and the
// charge is used. Both cells must read as open tunnel afterwards, and the cargo
// bay must still be empty: not a slot used, not a kilogram carried, and no entry
// under either id. Reading the bay is the whole point — a build that cleared the
// cells and banked what was in them satisfies the first half and fails the
// requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { captureReplay, createHarness, layOre, type Harness } from "../harness";
import { AFTERMATH_FRAMES, openBlastScene } from "./blast-scene";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("destroys ore and gemstones caught in the block rather than banking them", async () => {
  const centre = await openBlastScene(h);
  const vein = { col: centre.col + 1, row: centre.row };
  const jewel = { col: centre.col - 1, row: centre.row };

  await layOre(h, vein.col, vein.row, "ferron");
  await layOre(h, jewel.col, jewel.row, "verdite");
  await h.debug.clearCargo();
  await h.debug.setItemCount("dynamite", 1);

  assertEqual((await h.tileAt(vein.col, vein.row)).ore, "ferron");
  assertEqual((await h.tileAt(jewel.col, jewel.row)).ore, "verdite");

  await captureReplay(h, "lost", async () => {
    await h.debug.useItem("dynamite");
    await h.advance(AFTERMATH_FRAMES);
  });

  assertEqual(
    (await h.tileAt(vein.col, vein.row)).kind,
    "tunnel",
    "the ore cell after the blast",
  );
  assertEqual(
    (await h.tileAt(jewel.col, jewel.row)).kind,
    "tunnel",
    "the gemstone cell after the blast",
  );

  const { cargo } = await h.snapshot();
  assertEqual(cargo.slotsUsed, 0, "slots used after the blast");
  assertEqual(cargo.loadKg, 0, "kilograms carried after the blast");
  assertDeepEqual(cargo.ore, {}, "the cargo bay after the blast");
});
