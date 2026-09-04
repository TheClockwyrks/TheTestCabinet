// controls/menu-confirm-takes-the-entry — `Enter` takes the entry the menu
// highlights.
//
// `specs/controls.md` § The actions: `confirm` is bound to `Enter` and does "take
// the highlighted menu item, on the screens showing a menu". `specs/ui.md` says
// the same of every menu — "`confirm` takes the highlighted entry" — and fixes
// what the title menu's entries lead to: "the menu `TITLE_ITEMS` (`SITES`, `HOW
// TO PLAY`) ... `SITES` opens `select`, `HOW TO PLAY` opens `howto`."
//
// THE SECOND ENTRY, NOT THE FIRST. `TITLE_ITEMS` is two entries and the highlight
// arrives at `0`, so a build that took the highlighted entry and a build that
// took the first entry whatever the highlight would both open `select` from index
// `0` — the same screen for the wrong reason. Index `1` separates them: only a
// build that reads the highlight opens `howto`.
//
// The highlight is posed with `setMenuIndex`, which "sets the highlighted entry
// of the menu on the screen showing" (`specs/instrumentation.md`), rather than
// walked there with `down`: the direction actions are their own review point, and
// a build whose menu movement is broken must fail that item and be decided fairly
// on this one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The `confirm` action's binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** `HOW TO PLAY`, the title menu's second entry, which opens `howto`. */
const ENTRY = TITLE_ITEMS.indexOf("HOW TO PLAY");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the screen the highlighted title entry leads to", async () => {
  await h.debug.setMenuIndex(ENTRY);
  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen `confirm` is taken on");
  assertEqual(posed.menuIndex, ENTRY, "the entry the menu highlights");

  await h.press(CONFIRM);
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the screen the highlighted entry opened");

  assertEqual(
    after.screen,
    "howto",
    `the screen after ${CONFIRM} with TITLE_ITEMS[${ENTRY}] highlighted, ` +
      "which is where HOW TO PLAY leads (specs/ui.md)",
  );
});
