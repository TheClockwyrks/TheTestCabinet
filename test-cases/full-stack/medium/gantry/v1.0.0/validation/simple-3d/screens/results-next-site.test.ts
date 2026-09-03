// screens/results-next-site — `NEXT SITE` opens the next site's build screen.
//
// `specs/ui.md` § The screens, Results, the entry table: "`NEXT SITE` | Opens the
// next site and shows its `build` screen." The menu is `RESULTS_ITEMS` (`NEXT
// SITE`, `REPLAY`, `SITE SELECT`), so `NEXT SITE` is index `0`, and "`menuIndex`
// `0` on arriving" is where the highlight already sits.
//
// THE SCENARIO IS A CLEARED SITE, posed rather than played. `results` is where "a
// cleared run moves to" (`specs/ui.md`), so the site standing cleared is what
// makes this screen reachable at all; `setCleared` records that precondition —
// "sets whether site `index` has been cleared this session, and with it which
// sites are open" — while running a tape to a clear would grade the statics, the
// rigging and the tape on the way to a question about one menu entry.
//
// SITE `0`, so there IS a next site: what the last site does with this entry is
// its own review point.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, RESULTS_ITEMS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** `NEXT SITE`, the results menu's first entry. */
const ENTRY = RESULTS_ITEMS.indexOf("NEXT SITE");

/** The site cleared, and the one `NEXT SITE` leads to. */
const SITE = 0;
const NEXT = SITE + 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens the next site's build screen from NEXT SITE", async () => {
  await openSite(h, SITE);
  await h.debug.setCleared(SITE, true);
  await h.debug.setScreen("results");
  await h.debug.setMenuIndex(ENTRY);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "results", "the screen the entry is taken on");
  assertEqual(posed.siteIndex, SITE, "the site the results are showing");
  assertEqual(posed.menuIndex, ENTRY, "the highlighted results entry");

  await h.press(CONFIRM);
  const entered = await h.snapshot();
  assertEqual(
    entered.screen,
    "build",
    "the screen NEXT SITE shows (specs/ui.md)",
  );
  assertEqual(
    entered.siteIndex,
    NEXT,
    `the site NEXT SITE opens from site ${SITE + 1} (specs/ui.md)`,
  );

  await h.advance(1);
  await h.capture("state", "The build screen NEXT SITE opened");
});
