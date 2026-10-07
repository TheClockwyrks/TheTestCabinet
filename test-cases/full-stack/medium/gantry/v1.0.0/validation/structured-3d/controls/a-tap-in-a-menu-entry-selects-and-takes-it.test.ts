// controls/a-tap-in-a-menu-entry-selects-and-takes-it — a touch contact landing
// and lifting inside one entry's region selects it and takes it.
//
// `specs/ui.md` § The screens: "A touch contact lands and lifts inside one
// entry's region | The highlight moves to that entry, and that entry is taken",
// and "A contact has no hover, so its landing is what moves the highlight". The
// title menu's `HOW TO PLAY` opens `howto`, so that screen showing afterwards
// is what says the entry was taken.
//
// SO NOTHING HERE KNOWS A MENU COORDINATE. The contact lands in the middle of
// the region the build reports for the entry through `menuItemRect`.
//
// THE HIGHLIGHT IS POSED OFF THE TARGET FIRST, so a build that took whatever
// the highlight already sat on rather than the entry the contact landed in
// reaches `select` instead of `howto` and fails.
//
// A CONTACT AND NOT THE POINTER. `specs/controls.md` has the runtime deliver a
// contact's landing and its lift apart from the pointer's press and release, so
// this drives the touch pair rather than a click: a build that reads the
// pointer alone leaves the menus unplayable with a finger, and this is the
// point that says so. A frame runs after each edge, so a build acting on the
// event and a build acting on the frame that reads it are both given the tap.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { createHarness, tapItem, type Harness } from "../harness";

/** `HOW TO PLAY`: the entry tapped, and the screen it opens. */
const TARGET = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** `SITES`: where the highlight is posed, so the tap has to move it. */
const POSED = TITLE_ITEMS.indexOf("SITES");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("selects and takes the entry a contact lands and lifts inside", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen the contact lands on");
  assertEqual(posed.menuIndex, POSED, "the highlight the tap has to move");

  await tapItem(h, TARGET);
  const after = await h.snapshot();

  await h.capture("state", "the screen a tap on a menu entry reached");

  assertEqual(
    after.screen,
    "howto",
    "the screen HOW TO PLAY opens, taken by a contact that landed and lifted " +
      "inside its own region (specs/ui.md)",
  );
});
