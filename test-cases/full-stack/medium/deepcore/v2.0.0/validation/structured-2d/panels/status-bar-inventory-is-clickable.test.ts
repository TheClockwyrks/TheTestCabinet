// panels/status-bar-inventory-is-clickable — the bar's inventory control answers
// a press.
//
// `specs/controls.md`: "A pointer pressed and released ... inside one panel or
// status-bar control's region: that control acts, exactly as its keyboard route
// does." `specs/ui.md` gives the bar the inventory, pause and mute controls; the
// inventory one is driven here because its effect is a field of its own that
// nothing else in the scene touches.
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
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  layCamp,
  openScene,
  pinDrill,
  pinMiner,
  standAtCamp,
  type Harness,
} from "../harness";
import { clickControl } from "./mouse";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the inventory from the region the status bar reports for it", async () => {
  openScene(h);
  layCamp(h);
  pinMiner(h);
  pinDrill(h);
  standAtCamp(h);
  await h.advance(1);

  await clickControl(h, "inventory");
  captureStill(h, "bar");

  assertEqual(
    h.snapshot().panel,
    "inventory",
    "specs/ui.md: the bar's inventory control, pressed at its region, opens the inventory",
  );
});
