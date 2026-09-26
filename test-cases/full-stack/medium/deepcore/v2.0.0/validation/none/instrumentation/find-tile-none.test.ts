// instrumentation/find-tile-none — no cell of that kind, and the reading is null.
//
// `specs/instrumentation.md`: `findTile(kind)` returns "The `{ col, row }` of a
// cell of that kind, the one nearest the miner where several exist, or `null`
// where the mine holds none."
//
// THIS POINT DECIDES THE SECOND HALF, which is an edge case and so has a
// validator of its own: with the mine holding none of that kind at all the
// reading is `null`, which a build that cached its last answer, or that clamps to
// the closest cell of some other kind, fails.
//
// THE READING IS TAKEN AFTER ONE WAS THERE. A cell is posed, read back, and then
// taken away, so the `null` is a real absence answered by a surface that had just
// answered otherwise — which is the shape a cached answer fails and a fresh
// search passes.
//
// LAVA IS THE KIND POSED, because an empty mine holds none of it: `reset` leaves
// the grid as `clearMine` does, so the one cell this poses is the only lava in the
// world and taking it away leaves a mine with none.

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

/** The one posed cell, which is then taken away again. */
const CELL = { col: COL + 3, row: ROW };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports null once the mine holds no cell of that kind", async () => {
  await openScene(h);
  await h.debug.setTile(COL, ROW, "rock");
  await standOn(h, COL, ROW);
  await pinDrill(h);
  await h.debug.setTile(CELL.col, CELL.row, "lava");
  await h.advance(2);

  // The surface has just answered with a cell, so what follows is a fresh search
  // rather than a first one.
  assertDeepEqual(
    await h.debug.findTile("lava"),
    CELL,
    "the posed lava cell, before it is taken away",
  );

  await h.debug.setTile(CELL.col, CELL.row, "tunnel");
  await h.advance(1);
  await captureStill(h, "none");

  assertNull(
    await h.debug.findTile("lava"),
    "the reading with no lava in the mine",
  );
});
