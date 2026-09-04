// screens/howto-back-returns-to-title — back leaves how-to for the title, with
// the highlight on the entry that led there.
//
// specs/ui.md, "How to play": "`back` returns to `title` with the highlight on
// `HOW TO PLAY`, the entry that led here, so `menuIndex` reads `1`." That is
// one requirement with two halves, and the second is the interesting one: the
// title screen's own opening state highlights `SITES`, so a build that reset
// the highlight on arriving would read `0` here and fail.
//
// THE HIGHLIGHT IS POSED OFF ONE FIRST, or the second half asserts nothing. The
// title screen is shown, its highlight moved to `SITES` (index `0`), and only
// then is the how-to screen shown: `setScreen` "shows a named screen and sets
// nothing else", so the highlight is still `0` when `back` is pressed. A build
// that merely left `menuIndex` alone would read `0` here and fail.
//
// `back` is delivered as its binding, `Escape` (specs/controls.md), held across
// a tick so a build reading held state at the top of a frame sees it exactly as
// one latching the edge does.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, TITLE_ITEMS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `back`, as specs/controls.md binds it. */
const BACK = BINDINGS.back[0] as string;

/** `HOW TO PLAY`: the title entry how-to is reached through. */
const HOWTO_ENTRY = TITLE_ITEMS.indexOf("HOW TO PLAY");

/** `SITES`: the other entry, posed first so the return has something to move. */
const OTHER_ENTRY = TITLE_ITEMS.indexOf("SITES");

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with HOW TO PLAY selected", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(OTHER_ENTRY);
  await h.debug.setScreen("howto");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "howto", "the screen this point presses back on");
  assertEqual(
    posed.menuIndex,
    OTHER_ENTRY,
    "the highlight carried onto the how-to screen, so the return this point " +
      "decides has something to move",
  );

  await h.press(BACK);

  const after = await h.snapshot();
  await h.capture("state", "the title screen back left the how-to screen for");

  assertEqual(
    after.screen,
    "title",
    "the screen back leaves the how-to screen for (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    HOWTO_ENTRY,
    "the title entry that led to how-to, which the return highlights " +
      "(specs/ui.md)",
  );
});
