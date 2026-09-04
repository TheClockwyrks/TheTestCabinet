// building/place-refused-when-invalid — committing an invalid footprint does
// nothing at all.
//
// specs/building.md, Placing: "Placing on an invalid footprint builds nothing,
// blocks nothing, and spends nothing."
//
// THE INVALIDITY IS THE PLAINEST ONE. The footprint overlaps a tower already
// standing, so condition 2 — every tile of the footprint is open — is the one that
// fails, and it is the ONLY one that fails: the block is on the grid, no surge unit
// is on the floor, the purse is far above the cost, Containment fixes no build
// zone, and neither the standing tower nor the candidate comes near sealing a
// route. So a refusal here is a refusal for the stated reason.
//
// THE TOWER ALREADY STANDING IS POSED WITH `poseTower`, the atom: it costs nothing
// and runs no check (specs/instrumentation.md), so the balance this check reads is
// the one it posed and the refusal is not being compared against a purse a second
// placement already moved.
//
// THREE CONSEQUENCES, ONE PER CLAUSE. Builds nothing: the roster is the length it
// was. Spends nothing: the balance is the figure it was. Blocks nothing: a tile of
// the refused footprint that was open floor is still open afterwards, read through
// the same placement check `building/place-blocks-the-tiles` reads it through.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  poseTower,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview, probeValid } from "./preview";
import { FREE_SITE } from "./sites";

/** The tower already standing, and the type the refused placement holds. */
const HELD = "arc";
const STANDING = FREE_SITE;

/**
 * The refused footprint, anchored on the standing tower's bottom-right tile. Its
 * 2x2 block covers that tile — under the tower — and three tiles of open floor.
 */
const REFUSED_COL = STANDING.col + 1;
const REFUSED_ROW = STANDING.row + 1;

/** A tile of the refused footprint that was open floor before it was refused. */
const OPEN_COL = STANDING.col + 2;
const OPEN_ROW = STANDING.row + 2;

/** Enough money that affordability is never what refuses anything here. */
const PURSE = 1000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("builds nothing, blocks nothing and spends nothing on an invalid footprint", async () => {
  startRun(h);
  h.debug.setMoney(PURSE);
  poseTower(h, HELD, STANDING.col, STANDING.row);

  const before = h.snapshot();

  h.debug.setArmed(HELD);
  h.debug.setPreview(REFUSED_COL, REFUSED_ROW);
  const preview = heldPreview(h);
  assertEqual(
    preview.valid,
    false,
    `a ${HELD} footprint at (${REFUSED_COL}, ${REFUSED_ROW}), overlapping the ` +
      "tower already standing",
  );

  h.debug.place();
  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "refused");

  assertEqual(
    after.towers.length,
    before.towers.length,
    "the number of towers on the floor after a refused placement",
  );
  assertEqual(
    after.money,
    before.money,
    "the balance after a refused placement",
  );
  assertEqual(
    probeValid(h, HELD, OPEN_COL, OPEN_ROW),
    true,
    `tile (${OPEN_COL}, ${OPEN_ROW}), open floor the refused footprint covered`,
  );
});
