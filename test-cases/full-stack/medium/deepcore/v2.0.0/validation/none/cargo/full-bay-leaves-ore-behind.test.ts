// cargo/full-bay-leaves-ore-behind — a full bay never hard-locks the mine.
//
// specs/mining.md: drilling an ore cell banks one unit "when a slot is free", and
// "when the bay is full by slot count the cell still clears to tunnel and the ore
// is left behind, with a `cargo full` note shown". So a full bay costs the player
// the ore rather than trapping the miner behind a cell that will not break.
//
// The bay is filled to exactly the cargo tier's capacity with one ore, and an ore
// cell of a different ore is posed under the miner and cut through. The reading
// is the cell — open tunnel, as any broken cell is — with the bay untouched: the
// same slots used, the same load, and no unit of the ore that was left behind.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CARGO_CAPACITY, ORES } from "../constants";
import {
  captureReplay,
  createHarness,
  driveCut,
  layOre,
  openScene,
  pinMiner,
  stageCargo,
  standOn,
  type Harness,
} from "../harness";

/** A column and a row well clear of the camp, the cave mouth, and the Core. */
const COL = 8;
const ROW = 12;

/** The ore the bay is filled with, and the one the cut would have banked. */
const HELD = "ferron";
const CUT = "cuprite";

/** The capacity at the tier a fresh expedition opens at. */
const CAP = CARGO_CAPACITY[0];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("clears the cell and leaves the ore behind when the bay is full", async () => {
  await openScene(h);
  await stageCargo(h, { [HELD]: CAP });
  await layOre(h, COL, ROW, CUT);
  await standOn(h, COL, ROW);
  await pinMiner(h);

  const before = await h.snapshot();
  assertEqual(before.cargo.slotCap, CAP, "specs/upgrades.md");
  assertEqual(before.cargo.slotsUsed, CAP, "specs/mining.md");
  assertEqual((await h.tileAt(COL, ROW)).ore, CUT, "specs/instrumentation.md");

  const cut = await captureReplay(h, "full", () =>
    driveCut(h, "down", { col: COL, row: ROW }),
  );

  // The cell broke like any other, so a full bay is not a wall.
  assertEqual(cut.broke, true, "specs/mining.md");
  assertEqual(cut.tile.kind, "tunnel", "specs/mining.md");
  // And the ore went nowhere.
  assertEqual(cut.snapshot.cargo.ore[CUT] ?? 0, 0, "specs/mining.md");
  assertEqual(cut.snapshot.cargo.slotsUsed, CAP, "specs/mining.md");
  assertEqual(
    cut.snapshot.cargo.loadKg,
    CAP * ORES[HELD].weight,
    "specs/mining.md",
  );
});
