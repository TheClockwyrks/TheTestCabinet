// drilling/material-banks — breaking a material node banks its material.
//
// specs/character.md: a material node banks its material into the satchel when
// it breaks, and every broken cell becomes an open tunnel. specs/mining.md adds
// that drilling a material node removes the node, and that the exotic materials
// are not cargo: they take no slot, carry no weight, and ride in a satchel of
// their own.
//
// The node posed is Resonite, in the rockbed band its single generated node
// belongs to, so the cell's `BAND_HEALTH` is the one that band's nodes really
// carry. The miner's body is held still, so the cut is the drill's alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BAND_HEALTH, MATERIAL_BAND } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  layMaterial,
  openScene,
  pinMiner,
  rowInBand,
  standOn,
  type Harness,
} from "../harness";

/** A column well clear of the camp, the cave mouth, and the Core. */
const COL = 8;

/** The material posed, and the band its node belongs to. */
const MATERIAL = "resonite";
const BAND = MATERIAL_BAND[MATERIAL];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("banks the node's material into the satchel and clears the cell", async () => {
  await openScene(h);
  const { coreRow } = await h.snapshot();
  const row = rowInBand(BAND, coreRow);
  await layMaterial(h, COL, row, MATERIAL);
  await standOn(h, COL, row);
  await pinMiner(h);

  const opening = await h.tileAt(COL, row);
  assertEqual(opening.kind, "material", "specs/instrumentation.md");
  assertEqual(opening.material, MATERIAL, "specs/instrumentation.md");
  assertEqual(opening.health, BAND_HEALTH[BAND], "specs/world.md");
  assertEqual((await h.snapshot()).satchel[MATERIAL], 0, "specs/expedition.md");

  const cut = await captureReplay(h, "node", () =>
    driveCut(h, "down", { col: COL, row }),
  );

  assertEqual(cut.broke, true, "specs/character.md");
  assertEqual(cut.tile.kind, "tunnel", "specs/mining.md");
  assertEqual(cut.tile.material, null, "specs/mining.md");
  assertEqual(cut.snapshot.satchel[MATERIAL], 1, "specs/character.md");
  // Not cargo: no slot taken and no weight carried.
  assertEqual(cut.snapshot.cargo.slotsUsed, 0, "specs/mining.md");
  assertEqual(cut.snapshot.cargo.loadKg, 0, "specs/mining.md");
});
