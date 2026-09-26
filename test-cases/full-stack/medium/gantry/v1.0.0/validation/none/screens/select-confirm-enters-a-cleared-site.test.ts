// screens/select-confirm-enters-a-cleared-site — `confirm` on a cleared site
// enters it.
//
// `specs/ui.md` § The screens, Site select: "`confirm` on an open or cleared site
// enters it, opening the `build` screen with that site's stored structure and
// tape." A cleared site is not spent: it is entered exactly as an open one is, and
// `specs/ui.md` says so again of the list — "cleared and open sites stay so for
// the session".
//
// THE CLEARED HALF OF THAT SENTENCE IS WHAT THIS ITEM DECIDES, so the site is
// posed cleared and nothing else about it is touched. `setCleared` "sets whether
// site `index` has been cleared this session, and with it which sites are open"
// (`specs/instrumentation.md`), which is the precondition a clear leaves and not
// an outcome; running a site to a clear would grade the run as much as the entry.
//
// `reset` first, so the list is the one `specs/ui.md` describes — site `0` open,
// nothing else cleared — and the one row posed cleared is the row confirmed on.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { BINDINGS } from "../constants";
import { createHarness, type Harness } from "../harness";

/** `confirm`'s binding, as `specs/controls.md` fixes it. */
const CONFIRM = BINDINGS.confirm[0]!;

/** The site posed cleared, and the row the highlight sits on. */
const SITE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a cleared site's build screen under confirm", async () => {
  await h.debug.reset();
  await h.debug.setCleared(SITE, true);
  await h.debug.setScreen("select");
  await h.debug.setMenuIndex(SITE);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "select", "the screen `confirm` is taken on");
  assertTrue(posed.cleared[SITE] === true, `site ${SITE + 1} standing cleared`);

  await h.press(CONFIRM);
  const entered = await h.snapshot();
  await h.advance(1);
  await h.capture(
    "build-from-cleared",
    "The build screen entered from a cleared site",
  );

  assertEqual(
    entered.screen,
    "build",
    `the screen \`confirm\` on cleared site ${SITE + 1} opens (specs/ui.md)`,
  );
  assertEqual(
    entered.siteIndex,
    SITE,
    "the site entered by `confirm` on a cleared row (specs/ui.md)",
  );
});
