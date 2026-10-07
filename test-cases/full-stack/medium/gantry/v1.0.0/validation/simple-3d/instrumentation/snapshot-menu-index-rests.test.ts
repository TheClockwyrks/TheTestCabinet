// instrumentation/snapshot-menu-index-rests — menuIndex rests on a screen with
// no menu.
//
// `specs/instrumentation.md` § Snapshot shape, the resting-value table:
// `menuIndex` is "`0` before a menu has been moved, and on a screen with no menu
// — `howto`, `build`, `program`, and `run` — what the last menu screen left it
// holding". `specs/state.md` says the same from the state's side: "A screen with
// no menu highlights nothing and leaves it as it stands."
//
// The scenario is the select screen, whose menu lists `SITE_COUNT` (`6`) sites
// (`specs/ui.md`), so index `3` is inside the domain `setMenuIndex` states. The
// move onto the menuless screen is `setScreen`, which "shows a named screen and
// sets nothing else; `menuIndex` is left as it stands" — the one route that poses
// the screen and nothing else, so what is read afterwards is the resting value and
// not something a site opening or a menu arrival wrote.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { createHarness, type Harness } from "../harness";

/** Inside the six entries the select screen's menu carries (specs/ui.md). */
const HIGHLIGHT = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds what the last menu screen left it on a screen with no menu", async () => {
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(HIGHLIGHT);
  const onMenu = await h.snapshot();
  assertEqual(
    onMenu.menuIndex,
    HIGHLIGHT,
    `the highlight setMenuIndex(${HIGHLIGHT}) left on the select screen, ` +
      "which is the scenario this point rests on",
  );

  await h.debug.setScreen("build");
  const menuless = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    menuless.menuIndex,
    HIGHLIGHT,
    "menuIndex on the build screen, which shows no menu, so it holds what the " +
      "last menu screen left it (specs/instrumentation.md)",
  );
});
