// panels/inventory-drop-ore-is-clickable — an ore row's drop control answers a
// press.
//
// `specs/controls.md`: "A pointer pressed and released, or a touch contact landed
// and lifted, inside one panel or status-bar control's region: that control acts,
// exactly as its keyboard route does."
//
// WHERE IT IS DRAWN IS THE BUILD'S. `specs/overview.md` hands the layout over, so
// nothing here searches the screen: `controlRegion` asks the build through
// `specs/instrumentation.md`'s `controlRect` and the press lands in the middle of
// the region it named. A build that reports no region for a control it is
// required to draw fails this point, naming what was missing.
//
// ONE CONTROL PER POINT. The `controlRect` table names sixteen controls and each
// is a surface a player presses, so a build where one of them ignores the pointer
// must grade differently from a build where none of them answers. WHAT the
// control does once it acts is decided by the points that drive its own route;
// this one decides only that the press reaches it.
//
// THE CONTROL TAKES A SUBJECT. `specs/instrumentation.md`: for `drop-ore` the
// `subject` is "an ore or gemstone id", and the control is "The inventory's drop
// control for that ore". One ore is staged in the bay so exactly one row is
// there to press.
//
// ISOLATION. The camp with the inventory posed open over a bay holding that one
// ore and nothing else, and the drill gated, so nothing can bank a unit while the
// press lands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  stageCargo,
  type Harness,
} from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** The ore in the bay, and how many units of it are staged. */
const ORE = "ferron";
const HELD = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("drops ore from the region the inventory reports for its row", async () => {
  openCamp(h);
  stageCargo(h, { [ORE]: HELD });
  h.debug.setPanel("inventory");
  await h.advance(1);

  const opened = h.snapshot();
  assertEqual(opened.cargo.ore[ORE], HELD, "the units staged in the bay");

  await clickRegion(h, controlRegion(h, "drop-ore", ORE));
  captureStill(h, "dropped");

  assertLessThan(
    h.snapshot().cargo.ore[ORE] ?? 0,
    HELD,
    "specs/ui.md: the row's drop control, pressed at its region, drops ore",
  );
});
