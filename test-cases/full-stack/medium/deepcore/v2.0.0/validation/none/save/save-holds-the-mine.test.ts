// save/save-holds-the-mine — the save carries the generated mine, shafts and all.
//
// specs/expedition.md lists "the generated mine and its world size" first among
// what a save holds, so continuing returns to the shafts already cut rather than
// to a freshly generated mine. specs/world.md adds that "the mine is generated
// fresh for each expedition from the current seed" and that a cell's kind is
// fixed at generation "except that a minable cell becomes an empty tunnel once it
// is drilled out" — so the grid IS the state a save has to carry.
//
// TWO READINGS, AND BOTH ARE NEEDED.
//
//   - A FINGERPRINT of the generated mine: a spread of cells sampled before the
//     save and read back after the restore. A build that regenerated instead of
//     restoring lands on a different scatter.
//   - A POSED SHAFT that generation never produces: a one-tile bore straight down
//     a column with a boulder capping it. A build that regenerated FROM THE SAME
//     SEED could still match the fingerprint; it cannot match this, because these
//     cells were carved after generation ran.
//
// `coreRow` is read back too, since the size travels with the mine.
//
// ISOLATION. One generated expedition with the slot cleared first, the miner
// standing at the camp where saving is allowed and its body and drill both gated
// so nothing moves or cuts between the two readings.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PLAYABLE_COL_MAX, PLAYABLE_COL_MIN, coreRowFor } from "../constants";
import {
  captureStill,
  createHarness,
  fillColumn,
  pinDrill,
  pinMiner,
  type Harness,
  type TileKind,
} from "../harness";
import { bankSave, continueFromTitle, openGeneratedAtCamp } from "./expedition";

/** The bore posed into the generated mine, and the boulder capping it. */
const SHAFT_COL = 9;
const SHAFT_FROM = 6;
const SHAFT_TO = 18;
const CAP_ROW = 19;

/** The fingerprint's spread: every eleventh column over a ladder of rows. */
const FINGERPRINT_ROWS = [3, 27, 61, 118, 199, 260, 333, 401, 470];

/** Every cell the fingerprint samples. */
function fingerprintCells(): { col: number; row: number }[] {
  const cells: { col: number; row: number }[] = [];
  for (const row of FINGERPRINT_ROWS) {
    for (let col = PLAYABLE_COL_MIN; col <= PLAYABLE_COL_MAX; col += 11) {
      cells.push({ col, row });
    }
  }
  return cells;
}

/** Read one cell's kind through the build's own `tileAt`. */
async function kindsAt(
  h: Harness,
  cells: readonly { col: number; row: number }[],
): Promise<TileKind[]> {
  const kinds: TileKind[] = [];
  for (const cell of cells)
    kinds.push((await h.tileAt(cell.col, cell.row)).kind);
  return kinds;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the same mine, with the shaft already cut still cut", async () => {
  await openGeneratedAtCamp(h);
  await pinMiner(h);
  await pinDrill(h);

  await fillColumn(h, SHAFT_COL, SHAFT_FROM, SHAFT_TO, "tunnel");
  await h.debug.setTile(SHAFT_COL, CAP_ROW, "stone");

  const cells = fingerprintCells();
  const before = await kindsAt(h, cells);
  await bankSave(h);

  await continueFromTitle(h);
  await h.advance(1);

  const restored = await h.snapshot();
  await captureStill(h, "mine");
  assertEqual(
    restored.coreRow,
    coreRowFor(restored.worldSize),
    "specs/world.md: coreRow follows the restored world size",
  );

  const after = await kindsAt(h, cells);
  for (let i = 0; i < cells.length; i += 1) {
    assertEqual(
      after[i],
      before[i],
      `specs/expedition.md: the save holds the generated mine, at (${cells[i].col}, ${cells[i].row})`,
    );
  }

  for (let row = SHAFT_FROM; row <= SHAFT_TO; row += 1) {
    assertEqual(
      (await h.tileAt(SHAFT_COL, row)).kind,
      "tunnel",
      `specs/expedition.md: the shaft already cut is still cut, at row ${row}`,
    );
  }
  assertEqual(
    (await h.tileAt(SHAFT_COL, CAP_ROW)).kind,
    "stone",
    "specs/expedition.md: the cell capping the shaft comes back as it was left",
  );
});
