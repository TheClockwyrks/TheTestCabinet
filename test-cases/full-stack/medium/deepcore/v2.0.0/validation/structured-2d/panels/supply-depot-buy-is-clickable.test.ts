// panels/supply-depot-buy-is-clickable — a supply's buy control answers a press.
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
// THE CONTROL TAKES A SUBJECT. `specs/instrumentation.md`: for `buy-item` the
// `subject` is "a field supply's id". Dynamite is the one driven here, and the
// count held is read back off the snapshot.
//
// ISOLATION. The camp with the Supply Depot's panel posed open, nothing held, and
// exactly the price of one Dynamite banked.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { ITEM_IDS, ITEM_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** The supply the press is aimed at, and what one costs. */
const SUPPLY = ITEM_IDS[0];
const PRICE = ITEM_PRICES[SUPPLY];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("buys a supply from the region the Supply Depot reports for it", async () => {
  openCamp(h);
  h.debug.clearItems();
  h.debug.setCredits(PRICE);
  h.debug.setPanel("supply-depot");
  await h.advance(1);

  await clickRegion(h, controlRegion(h, "buy-item", SUPPLY));
  captureStill(h, "bought");

  const bought = h.snapshot();
  assertEqual(
    bought.items[SUPPLY],
    1,
    "specs/ui.md: the supply's buy control, pressed at its region, buys one",
  );
  assertEqual(bought.credits, 0, "specs/items.md: and charges its price");
});
