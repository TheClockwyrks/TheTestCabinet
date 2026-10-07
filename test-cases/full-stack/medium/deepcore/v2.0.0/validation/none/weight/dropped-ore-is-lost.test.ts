// weight/dropped-ore-is-lost — a dropped unit is lost.
//
// specs/mining.md: each ore row in the inventory carries a drop control that
// discards one unit of that ore, and "the dropped unit is lost".
// specs/character.md says the same from the other side — dropped ore is lost
// rather than sold — and specs/items.md closes the last door: "ordinary dropped
// ore is not a ground item; a dropped unit is simply lost".
//
// So the reading is what a drop leaves behind: one unit fewer in the bay, one
// slot freed and its weight off the load, the Credits balance untouched, and
// nothing on the ground. specs/instrumentation.md has `coreGround` name the one
// ground item the game holds, a jettisoned Core Sample, so an ore that turned
// into a ground item would show up there; and the cell the miner stands over is
// read back to catch an ore put back into the mine as a tile.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { ORES } from "../constants";
import {
  captureStill,
  createHarness,
  layFloor,
  openScene,
  pinDrill,
  pinMiner,
  stageCargo,
  standOn,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** The bay posed, and the ore a unit is dropped from. */
const ORE = "argenite";
const HELD = 3;

/** The balance posed, so a sale of the dropped unit would be visible. */
const CREDITS = 500;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("discards the unit without banking it, dropping it, or returning it", async () => {
  await openScene(h);
  await layFloor(h, ROW);
  await standOn(h, COL, ROW);
  await pinMiner(h);
  await pinDrill(h);
  await h.debug.setCredits(CREDITS);
  await stageCargo(h, { [ORE]: HELD });
  await h.debug.setPanel("inventory");
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.cargo.slotsUsed, HELD, "specs/mining.md");
  assertEqual(before.cargo.loadKg, HELD * ORES[ORE].weight, "specs/mining.md");

  await h.debug.dropOre(ORE);
  await h.advance(1);
  await captureStill(h, "drop");

  const after = await h.snapshot();
  assertEqual(after.cargo.ore[ORE], HELD - 1, "specs/mining.md");
  assertEqual(after.cargo.slotsUsed, HELD - 1, "specs/mining.md");
  assertEqual(
    after.cargo.loadKg,
    (HELD - 1) * ORES[ORE].weight,
    "specs/mining.md",
  );
  // Lost rather than sold.
  assertEqual(after.credits, CREDITS, "specs/character.md");
  assertEqual(after.creditsEarned, 0, "specs/expedition.md");
  // Lost rather than dropped as a ground item.
  assertNull(after.coreGround, "specs/items.md");
  // Lost rather than put back into the mine.
  assertEqual((await h.tileAt(COL, ROW - 1)).kind, "tunnel", "specs/items.md");
  assertEqual((await h.tileAt(COL, ROW)).kind, "rock", "specs/items.md");
});
