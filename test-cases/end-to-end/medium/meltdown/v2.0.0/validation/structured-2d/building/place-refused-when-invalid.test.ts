// building/place-refused-when-invalid — committing an invalid footprint does
// nothing at all.
//
// specs/building.md, Placing: "Placing on an invalid footprint builds nothing,
// blocks nothing, and spends nothing."
//
// THE INVALIDITY IS THE PLAINEST ONE. The footprint overlaps a tower already
// standing, so condition 2 — every tile of the footprint is open — is the one
// that fails, and it is the only one that fails: the block is on the grid, no
// surge unit is on the floor, the purse is far above the cost, Containment fixes
// no build zone, and the placement could not seal a route. So a refusal here is
// a refusal for the stated reason.
//
// THREE CONSEQUENCES, ONE PER CLAUSE. Builds nothing: the roster is the length it
// was. Spends nothing: the balance is the figure it was. Blocks nothing: the one
// tile of the refused footprint that was open floor is still open afterwards,
// read through the placement check the way `building/place-blocks-the-tiles`
// reads it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import {
  captureStill,
  createHarness,
  placeAt,
  startRun,
  type Harness,
} from "../harness";
import { heldPreview, probeValid } from "./preview";

/** The tower already standing, and the type the refused placement holds. */
const HELD = "arc";
const STANDING_COL = 10;
const STANDING_ROW = 8;

/**
 * The refused footprint, anchored on the standing tower's bottom-right tile. It
 * covers (11, 9) — under the tower — and (12, 9), (11, 10) and (12, 10), which
 * are open floor.
 */
const REFUSED_COL = 11;
const REFUSED_ROW = 9;

/** A tile of the refused footprint that was open floor before it was refused. */
const OPEN_COL = 12;
const OPEN_ROW = 10;

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

  const standing = placeAt(h, HELD, STANDING_COL, STANDING_ROW);
  assertNotNull(standing, "the tower the scenario stands on the floor");

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
