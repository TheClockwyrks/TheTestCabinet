// panels/upgrade-shop-buy-is-clickable — a track's buy control answers a press.
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
// THE CONTROL TAKES A SUBJECT. `specs/instrumentation.md`: `controlRect` "takes
// `subject` as the id the control acts on", and for `buy-upgrade` that is "an
// upgrade track's name". The drill track is the one driven here, and the tier it
// reaches is read back off the snapshot.
//
// ISOLATION. The camp with the Upgrade Shop's panel posed open and exactly the
// price of the second tier banked, so nothing but the press can move the tier.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { UPGRADE_PRICES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { openCamp } from "../economy/camp";
import { clickRegion, controlRegion } from "./mouse";

/** The track the press is aimed at. */
const TRACK = "drill";

/**
 * What the step from tier 1 to tier 2 costs: `specs/upgrades.md`'s first rung,
 * `300`, and the only rung a track at its starting tier can be on.
 */
const PRICE = Math.min(...UPGRADE_PRICES.filter((price) => price > 0));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("buys a tier from the region the Upgrade Shop reports for the track", async () => {
  await openCamp(h);
  await h.debug.setCredits(PRICE);
  await h.debug.setPanel("upgrade-shop");
  await h.advance(1);

  const opened = await h.snapshot();
  assertEqual(opened.tiers[TRACK], 1, "specs/expedition.md: the starting tier");

  await clickRegion(h, await controlRegion(h, "buy-upgrade", TRACK));
  await captureStill(h, "bought");

  const bought = await h.snapshot();
  assertEqual(
    bought.tiers[TRACK],
    2,
    "specs/ui.md: the track's buy control, pressed at its region, buys the tier",
  );
  assertEqual(
    bought.credits,
    0,
    "specs/upgrades.md: and charges the tier's price",
  );
});
