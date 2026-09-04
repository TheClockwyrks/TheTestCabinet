// controls/key-dismantle — `KeyX` dismantles the selected structure.
//
// THE REQUIREMENT. `specs/controls.md` binds `dismantle` to `KeyX`: "Dismantles
// the selected structure", available in a build phase.
// `specs/scrap-press.md` fixes what removing it does to the yard: the four tiles
// its footprint held return to Open and the ground route is recomputed, so a
// structure that had walled the chain stops walling it.
//
// HOW IT IS DECIDED. One component is stood across the chain's opening leg on an
// otherwise empty yard, which lengthens the ground route, and is selected. `KeyX`
// is pressed as a player presses it, a real key event dispatched at the engine's
// own surface. Three things are read: the yard is empty again, the route is back
// to the length it had with nothing on it, and a fresh placement lands on exactly
// those tiles — which `specs/yard.md` refuses unless they are Open, so a placement
// that lands is the reading that says they are.

import { afterEach, beforeEach, it } from "vitest";

import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  keyFor,
  openYard,
  pressAction,
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

afterEach(() => {
  h.dispose();
});

it("removes the selected structure and reopens its tiles on KeyX", async () => {
  openYard(h);
  const empty = h.snapshot().mazeLength;

  const id = standComponent(h, "capacitor", 2, ANCHOR.col, ANCHOR.row);
  h.debug.select(id);
  const walled = h.snapshot();
  assertGreaterThan(
    walled.mazeLength,
    empty,
    "a structure stood across the chain's opening leg to lengthen the ground " +
      "route (specs/pathing.md)",
  );

  await pressAction(h, "dismantle");
  captureStill(h, "dismantled");

  const after = h.snapshot();
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
  standComponent(h, "emitter", 1, ANCHOR.col, ANCHOR.row);
});
