// panels/fuel-depot-fill-fuel-is-clickable — filling to full answers a press.
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
// empty and a balance that covers the whole of what is missing. The maximum is
// read off the snapshot rather than written down here, because the tier the tank
// starts at is `specs/upgrades.md`'s business and not this point's.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { FUEL_PRICE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** A part-empty tank, low enough that filling it is plainly a change. */
const FUEL_BEFORE = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("fills the tank from the region the Fuel Depot reports for the fill", async () => {
  openCamp(h);
  h.debug.setFuel(FUEL_BEFORE);
  const opened = h.snapshot();
  h.debug.setCredits(
    Math.ceil((opened.miner.maxFuel - FUEL_BEFORE) * FUEL_PRICE),
  );
  h.debug.setPanel("fuel-depot");
  await h.advance(1);

  await clickRegion(h, controlRegion(h, "fill-fuel"));
  captureStill(h, "filled");

  const filled = h.snapshot();
  assertCloseTo(
    filled.miner.fuel,
    filled.miner.maxFuel,
    6,
    "specs/ui.md: the fill control, pressed at its region, fills the tank",
  );
});
