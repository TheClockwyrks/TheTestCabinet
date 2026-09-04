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
import { BINDINGS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `back`'s binding, as `specs/controls.md` fixes it. */
const BACK = BINDINGS.back[0]!;

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
  assertEqual(
    (await h.snapshot()).screen,
    "title",
    "the screen `back` on `select` returns to (specs/ui.md)",
  );

  await h.advance(1);
  await h.capture("state", "The screen back returned to from the site list");
});
