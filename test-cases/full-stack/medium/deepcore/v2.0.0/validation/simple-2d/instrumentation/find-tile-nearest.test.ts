// instrumentation/find-tile-nearest — the nearest cell of a kind, of several.
//
// `specs/instrumentation.md`: `findTile(kind)` returns "The `{ col, row }` of a
// cell of that kind, the one nearest the miner where several exist, or `null`
// where the mine holds none."
//
// THIS POINT DECIDES THE FIRST HALF. With two cells of one kind posed at plainly
// different distances the reading is the NEARER of them, which a build that
// returns the first cell of its own scan order fails.
//
// THE ABSENCE IS ITS OWN POINT. `instrumentation/find-tile-none` decides the
// `null` — an edge case, and the guide gives each edge case its own validator, so
// a build that returns any lava cell rather than the nearest and a build that
// returns a stale cell when none exists grade differently.
//
// LAVA IS THE KIND POSED, because an empty mine holds none of it: `reset` leaves
// the grid as `clearMine` does, so the two cells this poses are the only lava in
// the world. The distances are three cells and twenty-four, which is the nearer
// cell under any distance a build might measure in.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
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

afterEach(() => {
  h?.dispose();
});

it("reports the nearer of two posed cells", async () => {
  openScene(h);
  h.debug.setTile(COL, ROW, "rock");
  standOn(h, COL, ROW);
  pinDrill(h);
  h.debug.setTile(NEAR.col, NEAR.row, "lava");
  h.debug.setTile(FAR.col, FAR.row, "lava");
  await h.advance(2);
  captureStill(h, "nearest");

  assertDeepEqual(
    h.debug.findTile("lava"),
    NEAR,
    "the nearest lava cell to the miner",
  );
});
