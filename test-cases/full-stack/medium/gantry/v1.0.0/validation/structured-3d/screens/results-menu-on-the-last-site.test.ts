// screens/results-menu-on-the-last-site — the last site's results menu leaves
// NEXT SITE out.
//
// `specs/ui.md` § The screens, Results: "`results` shows `CLEARED_TEXT` (`SITE
// CLEARED`), the run's cost and time beside the site's par cost and par time
// (`specs/sites.md`), and the menu `RESULTS_ITEMS` (`NEXT SITE`, `REPLAY`, `SITE
// SELECT`), with `menuIndex` `0` on arriving. On the last site `NEXT SITE` is
// left out and the menu is the other two entries in the same order."
//
// THE LAST SITE IS INDEX `SITE_COUNT - 1`, Heavy Haul, and `openSite` reaches it
// "locked or not" (`specs/instrumentation.md`) — which is what lets this item be
// decided without playing five sites to get there. The clear itself is posed with
// `setCleared`, the precondition a clear leaves, because `results` is where "a
// cleared run moves to" and running a tape to a real clear would grade the
// statics and the rigging on the way to a question about one menu.
//
// WHAT IS READ IS THE FRAME'S OWN TEXT. The snapshot reports the highlighted
// entry and never the entries, so the menu a build actually offers is only
// visible in what it drew, which `h.screenCalls()` answers with every text call
// measured. Copy is matched with the shared harness's `drewTextAnywhere` — the
// frame's logical runs joined in reading order with the whitespace folded out,
// as a substring ignoring case — so an entry drawn with a selection marker,
// letter-spaced or split across calls reads the same as one drawn whole; and
// `NEXT SITE` is looked for that way too, so a build that draws it dimmed or
// padded is still caught leaving it in.
//
// BOTH HALVES OF THE SENTENCE ARE ONE REQUIREMENT: the menu is "the other two
// entries in the same order", which is not decided by their presence alone. The
// order is the run each entry starts in among those same runs (`./reading`).

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns, drewTextAnywhere } from "../case-harness/text";
import { assertEqual, assertTrue, fail } from "../assert";
import { RESULTS_ITEMS, SITE_COUNT } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";
import { runStarting } from "./reading";

/** The last site: Heavy Haul, at index `SITE_COUNT - 1`. */
const LAST = SITE_COUNT - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("offers REPLAY then SITE SELECT and no NEXT SITE on the last site", async () => {
  await openSite(h, LAST);
  await h.debug.setCleared(LAST, true);
  await h.debug.setScreen("results");
  await h.debug.setMenuIndex(0);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "results", "the screen the menu is read off");
  assertEqual(posed.siteIndex, LAST, "the site the results are showing");

  const calls = await h.screenCalls();
  const runs = drawnTextRuns(calls);
  await h.capture("state", "The results menu on the last site");

  assertTrue(
    runs.length > 0,
    "the results screen to draw text at all (specs/ui.md)",
  );
  const drawn = JSON.stringify(runs.map((run) => run.text));

  if (drewTextAnywhere(calls, RESULTS_ITEMS[0])) {
    fail(
      `the last site's results menu to leave "${RESULTS_ITEMS[0]}" out ` +
        "(specs/ui.md)",
      `it drew ${drawn}`,
    );
  }

  const replay = runStarting(runs, RESULTS_ITEMS[1]);
  const select = runStarting(runs, RESULTS_ITEMS[2]);
  if (replay === null || select === null) {
    fail(
      `the last site's results menu to be "${RESULTS_ITEMS[1]}" and ` +
        `"${RESULTS_ITEMS[2]}" (specs/ui.md)`,
      `it drew ${drawn}`,
    );
  }
  assertTrue(
    replay < select,
    `"${RESULTS_ITEMS[1]}" to be drawn before "${RESULTS_ITEMS[2]}", the ` +
      "order RESULTS_ITEMS lists them in (specs/ui.md)",
  );
});
