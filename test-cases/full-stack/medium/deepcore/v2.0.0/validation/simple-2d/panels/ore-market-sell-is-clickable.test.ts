// panels/ore-market-sell-is-clickable — the Ore Market's SELL answers a press.
//
// `specs/controls.md`: "A pointer pressed and released ... inside one panel or
// status-bar control's region: that control acts, exactly as its keyboard route
// does." The Ore Market's `SELL` is the control driven here, and the effect the
// specification names for it is the one read back: the bay is converted to Credits
// and emptied.
//
// WHERE EACH ONE IS. `specs/overview.md` hands the layout to the build, so
// nothing here knows where anything is drawn — it asks. `specs/instrumentation.md`
// declares `menuItemRect(index)` and `controlRect(control, subject)`, each
// reporting "the region a pointer or a touch contact drives that item or that
// control from", and `panels/mouse.ts` aims at the middle of the region the BUILD
// named. Nothing searches the screen.
//
// ONE SURFACE PER POINT. Every menu a screen shows and every named control in
// `specs/instrumentation.md`'s `controlRect` table has a point of its own, so a
// build where one of them ignores the pointer grades differently from a build
// where none of them answers. The menus are `panels/menu-items-are-clickable`,
// `panels/pause-menu-items-are-clickable` and
// `panels/end-screen-menu-items-are-clickable`; the controls are the
// `*-is-clickable` points beside this one, plus `audio/mute-control-toggles`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  stageCargo,
  standAtCamp,
  type Harness,
} from "../harness";
import { clickControl } from "./mouse";

/** The cargo the sale is driven with: one ore, a known count. */
const SOLD = { ore: "ferron" as const, count: 4 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("sells the bay from the region the Ore Market reports for SELL", async () => {
  openScene(h);
  layCamp(h);
  pinDrill(h);
  standAtCamp(h);
  stageCargo(h, { [SOLD.ore]: SOLD.count });
  h.debug.setCredits(0);
  h.debug.setPanel("ore-market");
  await h.advance(1);

  await clickControl(h, "sell");
  captureStill(h, "panel");

  const sold = h.snapshot();
  assertGreaterThan(
    sold.credits,
    0,
    "specs/ui.md: SELL, pressed at its region, converts the bay to Credits",
  );
  assertEqual(
    sold.cargo.slotsUsed,
    0,
    "specs/ui.md: and empties the bay it sold",
  );
});
