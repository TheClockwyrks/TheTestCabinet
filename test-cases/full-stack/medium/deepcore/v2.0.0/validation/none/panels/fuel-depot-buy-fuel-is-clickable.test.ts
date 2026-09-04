// panels/fuel-depot-buy-fuel-is-clickable — the fixed fuel increment answers a press.
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
// ISOLATION. The camp with the Fuel Depot's panel posed open, the tank part
// empty and a balance that covers the increment. Nothing else in the scene can
// move the fuel or the Credits while the press lands.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { FUEL_BUY_INCREMENT, FUEL_PRICE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** A tank with room for the whole increment, and a balance that covers it. */
const FUEL_BEFORE = 10;
const CREDITS_BEFORE = FUEL_BUY_INCREMENT * FUEL_PRICE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("buys fuel from the region the Fuel Depot reports for the increment", async () => {
  await openCamp(h);
  await h.debug.setFuel(FUEL_BEFORE);
  await h.debug.setCredits(CREDITS_BEFORE);
  await h.debug.setPanel("fuel-depot");
  await h.advance(1);

  await clickRegion(h, await controlRegion(h, "buy-fuel"));
  await captureStill(h, "bought");

  const bought = await h.snapshot();
  assertGreaterThan(
    bought.miner.fuel,
    FUEL_BEFORE,
    "specs/ui.md: the fuel increment, pressed at its region, buys fuel",
  );
  assertEqual(
    bought.credits,
    CREDITS_BEFORE - FUEL_BUY_INCREMENT * FUEL_PRICE,
    "specs/expedition.md: and charges the increment's price",
  );
});
