// screens/title-sites-opens-select — the title menu's first entry opens the site
// select screen.
//
// specs/ui.md § Title: the title screen shows "the menu `TITLE_ITEMS` (`SITES`,
// `HOW TO PLAY`), with `menuIndex` `0` on arriving. `SITES` opens `select`".
// § The screens: "`confirm` takes the highlighted entry".
// specs/controls.md binds `confirm` to `Enter`.
//
// The scenario poses the title screen with its highlight on entry `0` and takes
// that entry. The highlight is POSED rather than inherited from the opening
// state, so this decides what `SITES` does and not what a fresh arrival leaves
// the highlight on — that is its own point, and a build that arrived with the
// wrong highlight must fail there rather than here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

/** `TITLE_ITEMS` index 0, which is `SITES` (specs/ui.md § Title). */
const SITES = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the select screen when SITES is confirmed on the title menu", async () => {
  await h.debug.setScreen("title");
  await h.debug.setMenuIndex(SITES);

  await h.press("Enter");

  const { screen } = await h.snapshot();
  await h.advance(1);
  await h.capture("select-opened", "the screen SITES opened");

  assertEqual(
    screen,
    "select",
    "the screen `SITES` opens when the title menu's first entry is confirmed " +
      "(specs/ui.md § Title)",
  );
});
