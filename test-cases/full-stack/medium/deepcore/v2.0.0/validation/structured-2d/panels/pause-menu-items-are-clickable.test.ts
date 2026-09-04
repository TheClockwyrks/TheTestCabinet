// panels/pause-menu-items-are-clickable — the pause menu answers a press.
//
// `specs/controls.md`: "A pointer is pressed and released inside one menu item's
// region: that item becomes the highlighted item and is chosen, exactly as
// `activate` chooses it." `specs/ui.md` puts `RESUME`, `RESTART` and
// `QUIT TO MENU` on the pause menu, and this point presses `RESUME` and
// `QUIT TO MENU` at the regions the build reports for them.
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
import { PAUSE_ITEMS } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  openScene,
  pinDrill,
  pinMiner,
  type Harness,
} from "../harness";
import { clickMenuItem } from "./mouse";

const RESUME = PAUSE_ITEMS.indexOf("RESUME");
const QUIT = PAUSE_ITEMS.indexOf("QUIT TO MENU");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("resumes and quits from the regions the pause menu reports", async () => {
  openScene(h, { screen: "paused" });
  pinMiner(h);
  pinDrill(h);
  await h.advance(1);
  await clickMenuItem(h, RESUME);
  const resumed = h.snapshot().screen;

  openScene(h, { screen: "paused" });
  pinMiner(h);
  pinDrill(h);
  await h.advance(1);
  await clickMenuItem(h, QUIT);
  captureStill(h, "pause");
  const quit = h.snapshot().screen;

  assertEqual(
    resumed,
    "in-mine",
    "specs/ui.md: RESUME, pressed at its region, returns to the mine",
  );
  assertEqual(
    quit,
    "title",
    "specs/ui.md: QUIT TO MENU, pressed at its region, returns to the title",
  );
});
