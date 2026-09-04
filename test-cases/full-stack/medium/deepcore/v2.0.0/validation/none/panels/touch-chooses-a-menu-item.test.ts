// panels/touch-chooses-a-menu-item — a finger drives the menus too.
//
// `specs/controls.md`: "A touch contact lands and lifts inside one menu item's
// region: that item becomes the highlighted item and is chosen." `specs/ui.md`
// requires the game to be "fully playable with the keyboard for movement,
// drilling, and thrust, and with a pointer or a touch screen for the panels and
// menus", so a build a finger cannot drive is a build half its players cannot
// use.
//
// WHY THIS POINT IS SCOPED TO THE ENGINELESS CONFIGURATION. Under an engine,
// `specs/controls.md` says in so many words that "a mouse, a pen, and a finger
// all arrive on those same" pointer reads: the engine normalizes the device away
// before the build sees anything, so the build's own code is identical for the two
// and a touch check there would be grading the engine. Without an engine the
// build owns its input layer, so listening for a contact rather than for a mouse
// alone is genuinely its own work — which is what this decides.
//
// A REAL CONTACT, NOT A POSED POINTER. The gesture is dispatched to the browser,
// so it carries `pointerType: "touch"`, it arrives with no hover before it, and it
// exists only because this project's harness asks for a touchscreen context. A
// build that listens for `mousedown` alone never hears it.
//
// BOTH EDGES IN ONE REGION, which is what the specification makes a choice: the
// contact lands in the middle of the region the build reported for the item and
// lifts there, and the screen it reaches is the one `specs/ui.md` names for that
// entry.
//
// WHERE THE ITEM IS. `specs/overview.md` hands the layout to the build, so
// `specs/instrumentation.md`'s `menuItemRect(index)` reports it — "the region a
// pointer or a touch contact drives that item or that control from" — and the
// contact lands in the middle of what the build named.
//
// ISOLATION. The title reached directly with the slot cleared, so the menu is the
// two-entry one specs/ui.md lists with no save banked and `NEW EXPEDITION` leads
// it. Nothing about an expedition is touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS_NO_SAVE } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { menuItemRegion, touchRegion } from "./mouse";

/** The entry the contact chooses, and the one the highlight starts on. */
const CHOSEN = TITLE_ITEMS_NO_SAVE.indexOf("NEW EXPEDITION");
const STARTS_ON = TITLE_ITEMS_NO_SAVE.length - 1 - CHOSEN;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("highlights and chooses the menu item a contact lands and lifts on", async () => {
  await h.debug.setAutoStep(false);
  await h.debug.clearSave();
  await h.debug.reset();
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(STARTS_ON);
  await h.advance(1);

  await touchRegion(h, await menuItemRegion(h, CHOSEN));
  await captureStill(h, "touch");

  assertEqual(
    (await h.snapshot()).screen,
    "mode-select",
    "specs/controls.md: a touch contact landing and lifting inside NEW EXPEDITION's region chooses it",
  );
});
