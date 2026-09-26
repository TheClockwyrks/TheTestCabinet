// controls/a-click-in-a-menu-entry-takes-it — a press and release inside one
// entry's region takes that entry.
//
// `specs/ui.md` § The screens: "The pointer is pressed and released inside one
// entry's region | The highlight moves to that entry, and that entry is taken",
// and "Taking an entry does what `confirm` does with it on that screen". The
// title menu's `HOW TO PLAY` opens `howto`, so that screen showing afterwards
// is what says the entry was taken.
//
// SO NOTHING HERE KNOWS A MENU COORDINATE. The check asks the build where it
// drew the entry through `menuItemRect` and clicks the middle of what it
// answered.
//
// THE HIGHLIGHT IS POSED OFF THE TARGET FIRST, so a build that took whatever
// the highlight already sat on rather than the entry the press landed in
// reaches `select` instead of `howto` and fails.
//
// The gesture is a click and never an orbit drag: the pointer does not move
// between the down and the up, so it never reaches `CLICK_SLOP`
// (`specs/controls.md`). A frame runs inside the press and after the release,
// so a build acting on the event and a build acting on the frame that reads it
// are both given their click (`specs/instrumentation.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { TITLE_ITEMS } from "../constants";
import { clickItem, createHarness, type Harness } from "../harness";

/** `HOW TO PLAY`: the entry clicked, and the screen it opens. */
const TARGET = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** `SITES`: where the highlight is posed, so the click has to move it. */
const POSED = TITLE_ITEMS.indexOf("SITES");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("takes the entry a press and its release both fell inside", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(POSED);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "title", "the menu screen the click lands on");
  assertEqual(posed.menuIndex, POSED, "the highlight the click has to move");

  await clickItem(h, TARGET);
  const after = await h.snapshot();

  await h.capture("state", "the screen a click on a menu entry reached");

  assertEqual(
    after.screen,
    "howto",
    "the screen HOW TO PLAY opens, taken by a press and release inside its " +
      "own region (specs/ui.md)",
  );
});
