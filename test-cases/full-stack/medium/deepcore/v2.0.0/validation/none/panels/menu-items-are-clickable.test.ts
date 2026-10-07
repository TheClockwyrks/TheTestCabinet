// panels/menu-items-are-clickable — the menus that open an expedition answer a
// press.
//
// `specs/controls.md`: "A pointer is pressed and released inside one menu item's
// region: that item becomes the highlighted item and is chosen, exactly as
// `activate` chooses it." This point drives the three menus that lead from the
// title into the mine — the title, the mode choice and the size choice — and reads
// the screen each press reaches.
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
import { MODE_ITEMS, SIZE_ITEMS } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { clickRegion, menuItemRegion } from "./mouse";

/**
 * The title menu's leading item with the slot cleared.
 *
 * `specs/ui.md` leads the title menu with `CONTINUE` only while a save exists, so
 * a cleared slot puts `NEW EXPEDITION` at `0`, and that entry goes to
 * `mode-select`.
 */
const NEW_EXPEDITION = 0;

/** The entries the two choices are made on, by the order specs/ui.md fixes. */
const STANDARD_MODE = MODE_ITEMS.indexOf("STANDARD");
const QUICK_SIZE = SIZE_ITEMS.indexOf("QUICK");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("chooses a title, mode and size item pressed at its reported region", async () => {
  const walked = await captureReplay(h, "menus", async () => {
    await h.debug.setAutoStep(false);
    await h.debug.clearSave();
    await h.debug.reset();
    await h.debug.setScreen("title");
    await h.advance(1);
    await clickRegion(h, await menuItemRegion(h, NEW_EXPEDITION));
    const fromTitle = (await h.snapshot()).screen;

    await h.debug.setMenuIndex(STANDARD_MODE);
    await clickRegion(h, await menuItemRegion(h, STANDARD_MODE));
    const fromMode = (await h.snapshot()).screen;

    await h.debug.setMenuIndex(QUICK_SIZE);
    await clickRegion(h, await menuItemRegion(h, QUICK_SIZE));
    const fromSize = (await h.snapshot()).screen;

    return { fromTitle, fromMode, fromSize };
  });

  assertEqual(
    walked.fromTitle,
    "mode-select",
    "specs/ui.md: NEW EXPEDITION, pressed at its region, opens the mode choice",
  );
  assertEqual(
    walked.fromMode,
    "size-select",
    "specs/ui.md: a mode, pressed at its region, opens the size choice",
  );
  assertEqual(
    walked.fromSize,
    "in-mine",
    "specs/ui.md: a size, pressed at its region, begins the expedition",
  );
});
