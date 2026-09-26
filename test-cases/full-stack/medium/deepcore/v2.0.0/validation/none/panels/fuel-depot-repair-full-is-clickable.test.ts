// panels/fuel-depot-repair-full-is-clickable — repairing to full answers a press.
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
// ISOLATION. The camp with the Fuel Depot's panel posed open, the hull part gone
// and a balance that covers the whole of what is missing. The maximum is read off
// the snapshot rather than written down here, because the tier the hull starts at
// is `specs/upgrades.md`'s business and not this point's.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { REPAIR_PRICE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** A part-gone hull, low enough that mending it is plainly a change. */
const HULL_BEFORE = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("repairs to full from the region the Fuel Depot reports for the repair", async () => {
  await openCamp(h);
  await h.debug.setHull(HULL_BEFORE);
  const opened = await h.snapshot();
  await h.debug.setCredits(
    Math.ceil((opened.miner.maxHull - HULL_BEFORE) * REPAIR_PRICE),
  );
  await h.debug.setPanel("fuel-depot");
  await h.advance(1);

  await clickRegion(h, await controlRegion(h, "repair-full"));
  await captureStill(h, "repaired");

  const repaired = await h.snapshot();
  assertCloseTo(
    repaired.miner.hull,
    repaired.miner.maxHull,
    6,
    "specs/ui.md: the repair-to-full control, pressed at its region, mends the hull",
  );
});
