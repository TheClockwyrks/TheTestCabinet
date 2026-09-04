// screens/results-replay — `REPLAY` opens this site again and shows its build
// screen.
//
// `specs/ui.md` § The screens, Results, the entry table: "`REPLAY` | Opens this
// site again and shows its `build` screen." `REPLAY` is `RESULTS_ITEMS` index
// `1`, so the highlight is posed there with `setMenuIndex` — "sets the
// highlighted entry of the menu on the screen showing"
// (`specs/instrumentation.md`) — rather than walked there with `down`, which is
// the direction actions' own review point.
//
// THE SITE THE RESULTS ARE SHOWING IS THE READING. `REPLAY` and `NEXT SITE` both
// land on a `build` screen, so the screen alone would not tell them apart; what
// separates them is which site is open afterwards, and this entry leaves it where
// it was.
//
// The clear is posed rather than played, for the reason `results-next-site`
// gives: `setCleared` is the precondition a clear leaves, and a run to a real
// clear would grade the statics and the tape on the way to a menu entry.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { BINDINGS, RESULTS_ITEMS } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** `REPLAY`, the results menu's second entry. */
const ENTRY = RESULTS_ITEMS.indexOf("REPLAY");

/** The site the results are showing, and the one REPLAY opens again. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens this site again from REPLAY", async () => {
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
  assertEqual(entered.screen, "build", "the screen REPLAY shows (specs/ui.md)");
  assertEqual(
    entered.siteIndex,
    SITE,
    `the site REPLAY opens, which is site ${SITE + 1} again (specs/ui.md)`,
  );

  await h.advance(1);
  await h.capture("state", "The build screen REPLAY opened");
});
