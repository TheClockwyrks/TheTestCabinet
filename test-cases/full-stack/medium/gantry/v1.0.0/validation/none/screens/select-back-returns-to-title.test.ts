// screens/select-back-returns-to-title — back leaves the select screen for the
// title, with the highlight on the entry that led there.
//
// specs/ui.md, "Site select": "`back` returns to `title` with the highlight on
// `SITES`, the entry that led here, so `menuIndex` reads `0`." The interesting
// half is the highlight: the select screen carries a highlight of its own, over
// the six sites, and the return does not carry that index across — it puts the
// title menu on the entry the player left the title through.
//
// THE SELECT HIGHLIGHT IS POSED OFF ZERO FIRST, so a build that simply kept
// `menuIndex` where the select screen left it reads `3` here and fails, and one
// that reset it to `0` for the wrong reason still has to be reading the entry
// rather than the site.
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

/** `SITES`: the title entry the select screen is reached through. */
const SITES_ENTRY = TITLE_ITEMS.indexOf("SITES");

/** A site well away from `0`, so the return cannot pass by keeping the index. */
const POSED_SITE = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns to the title with SITES selected", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(POSED_SITE);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the screen this point presses back on");
  assertEqual(
    posed.menuIndex,
    POSED_SITE,
    "the site highlighted on the select screen, so the return this point " +
      "decides has something to move",
  );

  await h.press(BACK);

  const after = await h.snapshot();
  await h.capture("state", "the title screen back left the select screen for");

  assertEqual(
    after.screen,
    "title",
    "the screen back leaves the select screen for (specs/ui.md)",
  );
  assertEqual(
    after.menuIndex,
    SITES_ENTRY,
    "the title entry that led to the select screen, which the return " +
      "highlights (specs/ui.md)",
  );
});
