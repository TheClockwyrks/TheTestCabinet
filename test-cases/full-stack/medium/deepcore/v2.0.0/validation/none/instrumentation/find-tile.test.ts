// instrumentation/find-tile — the nearest cell of a kind, and null where none is.
//
// `specs/instrumentation.md`: `findTile(kind)` returns "The `{ col, row }` of a
// cell of that kind, the one nearest the miner where several exist, or `null`
// where the mine holds none."
//
// Two readings, and they are the two the sentence has. With two cells of one kind
// posed at plainly different distances the reading is the nearer of them, which a
// build that returns the first cell of its own scan order fails. With the mine
// holding none of that kind at all the reading is `null`, which a build that
// cached its last answer, or that clamps to the closest cell of some other kind,
// fails.
//
// LAVA IS THE KIND POSED, because an empty mine holds none of it: `reset` leaves
// the grid as `clearMine` does, so the two cells this poses are the only lava in
// the world and the `null` reading is a real absence rather than a search that
// ran out of budget. The distances are three cells and twenty-four, which is the
// nearer cell under any distance a build might measure in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  standOn,
  type Harness,
} from "../harness";

const COL = 4;
const ROW = 12;

/** The two posed cells: one three columns away, one twenty-four. */
const NEAR = { col: COL + 3, row: ROW };
const FAR = { col: COL + 24, row: ROW };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the nearer of two posed cells, and null once neither is there", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await pinDrill(h);
  await h.debug.setTile(NEAR.col, NEAR.row, "lava");
  await h.debug.setTile(FAR.col, FAR.row, "lava");
  await h.advance(2);
  await captureStill(h, "nearest");

  assertDeepEqual(
    await h.debug.findTile("lava"),
    NEAR,
    "the nearest lava cell to the miner",
  );

  // With both posed away, there is no lava in the mine at all.
  await h.debug.setTile(NEAR.col, NEAR.row, "tunnel");
  await h.debug.setTile(FAR.col, FAR.row, "tunnel");
  assertNull(
    await h.debug.findTile("lava"),
    "the reading with no lava in the mine",
  );
});
