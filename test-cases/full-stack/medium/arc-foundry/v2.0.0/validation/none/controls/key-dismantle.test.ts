// controls/key-dismantle — `KeyX` dismantles the selected structure.
//
// THE REQUIREMENT. `specs/controls.md` binds `dismantle` to `KeyX`: "Dismantles
// the selected structure", available "during a build phase only".
// `specs/scrap-press.md` says what that does to the yard: "Dismantling removes a
// structure, clears its four tiles back to Open, and recomputes the route."
//
// HOW IT IS DECIDED. The maze length of the empty yard is read first. One
// component is then stood ACROSS the map's own chain, where a wall really does
// lengthen the route, and selected. `KeyX` is pressed as a player presses it, a
// real browser key event through the build's own keyboard layer, and three things
// are read: the yard is empty of structures again, the maze length is back to
// what it was, and the four tiles are genuinely Open again — which is decided by
// standing a structure on that same anchor a second time, a placement
// `specs/yard.md` refuses unless all four tiles are Open.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { keyFor } from "../constants";
import {
  captureStill,
  createHarness,
  openYard,
  standComponent,
  type Harness,
} from "../harness";

/**
 * An anchor whose footprint lies across the Substation's opening leg.
 *
 * The map runs its entry at `(0, 5)` straight along row `5` to `WP1` at
 * `(44, 5)`, so a `2` by `2` footprint anchored at `(10, 4)` walls two tiles of
 * that leg and the ground route has to go around it (`specs/yard.md`).
 */
const ANCHOR = { col: 10, row: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the selected structure and reopens its tiles on KeyX", async () => {
  await openYard(h);
  const empty = (await h.snapshot()).mazeLength;

  const id = await standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  await h.debug.select(id);
  const walled = await h.snapshot();
  assertGreaterThan(
    walled.mazeLength,
    empty,
    "a structure stood across the chain's opening leg to lengthen the ground " +
      "route (specs/pathing.md)",
  );

  await h.tap(keyFor("dismantle"));
  await captureStill(h, "dismantled");

  const after = await h.snapshot();
  assertLength(
    after.structures,
    0,
    `pressing ${keyFor("dismantle")} with a structure selected to remove it ` +
      "(specs/controls.md)",
  );
  assertEqual(
    after.mazeLength,
    empty,
    "the maze length after the wall is gone and the route is recomputed " +
      "(specs/scrap-press.md)",
  );

  // And the four tiles are really Open again: `specs/yard.md` refuses a
  // placement whose tiles are not, so a placement that lands is the read.
  await standComponent(h, "emitter", 1, ANCHOR.col, ANCHOR.row);
});
