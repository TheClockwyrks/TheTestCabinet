// panels/inventory-use-item-is-clickable — a supply's USE control answers a press.
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
// THE CONTROL TAKES A SUBJECT. `specs/instrumentation.md`: for `use-item` the
// `subject` is "a field supply's id", and the control is "The inventory's `USE`
// control for that supply". Regenerative Nanobots are the one driven here: they
// are used from anywhere, so the scene needs nothing around the miner.
//
// ISOLATION. The camp with the inventory posed open over one supply held and the
// rest of the satchel empty, so the count read back moved for one reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** The supply the press is aimed at, and how many are held. */
const SUPPLY = "nanobots";
const HELD = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("uses a supply from the region the inventory reports for its USE", async () => {
  openCamp(h);
  h.debug.clearItems();
  h.debug.setItemCount(SUPPLY, HELD);
  h.debug.setHull(20);
  h.debug.setPanel("inventory");
  await h.advance(1);

  await clickRegion(h, controlRegion(h, "use-item", SUPPLY));
  captureStill(h, "used");

  assertEqual(
    h.snapshot().items[SUPPLY],
    HELD - 1,
    "specs/ui.md: the supply's USE, pressed at its region, uses one",
  );
});
