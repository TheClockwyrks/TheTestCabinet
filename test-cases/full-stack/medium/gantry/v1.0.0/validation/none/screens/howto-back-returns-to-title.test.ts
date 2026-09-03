// screens/howto-back-returns-to-title — back leaves how-to for the title, with
// the highlight back on the first entry.
//
// specs/ui.md, "How to play": "`back` returns to `title` with `menuIndex` `0`."
// That is one requirement with two halves, and the second is the interesting
// one: the title screen's arrival rule is stated the same way where the screen
// is introduced — "the menu `TITLE_ITEMS` (`SITES`, `HOW TO PLAY`), with
// `menuIndex` `0` on arriving" — so the highlight is placed by the arrival
// rather than left where it lay.
//
// THE HIGHLIGHT IS POSED OFF ZERO FIRST, or the second half asserts nothing. The
// title screen is shown, its highlight moved to `HOW TO PLAY` (index `1`, the
// entry a player reaches how-to through), and only then is the how-to screen
// shown: `setScreen` "shows a named screen and sets nothing else", so the
// highlight is still `1` when `back` is pressed. A build that merely left
// `menuIndex` alone would read `1` here and fail.
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

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with menuIndex 0 from the how-to screen", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(HOWTO_ENTRY);
  await h.debug.setScreen("howto");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "howto", "the screen this point presses back on");
  assertEqual(
    posed.menuIndex,
    HOWTO_ENTRY,
    "the highlight carried onto the how-to screen, so the arrival rule this " +
      "point decides has something to move",
  );

  await h.press(BACK);

  const after = await h.snapshot();
  assertEqual(
    after.screen,
    "title",
    "the screen back leaves the how-to screen for (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    0,
    "the highlight the title screen carries on arriving (specs/ui.md)",
  );

  await h.capture("state", "the title screen back left the how-to screen for");
});
