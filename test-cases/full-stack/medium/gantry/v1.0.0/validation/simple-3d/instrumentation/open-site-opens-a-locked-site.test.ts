// instrumentation/open-site-opens-a-locked-site — openSite reaches a site the
// player has not unlocked.
//
// `specs/instrumentation.md` § The run and the screens: `openSite(index)` "Opens
// site `index`, counted from `0`, locked or not", and the prose beneath the table
// says why it matters — "It is the surface's way onto any site without playing to
// it". `specs/ui.md` fixes what locked means: "The site at index `0` is open from
// the start, the site at index `n + 1` opens once the site at index `n` is
// cleared."
//
// So the scenario is a session in which nothing has been cleared. `reset` makes
// one — "every site uncleared with no recorded score" — and site `5` is then four
// clears away from being reachable in play. Two things are read: that the site
// opened all the same, and that the session's clears are untouched, which is what
// "without any site before it being cleared" means. A build that unlocked its way
// there by marking the earlier sites cleared would pass the first reading and fail
// the second.
//
// Nothing else is posed. The screen the call lands on and the figures the site
// carries are their own points.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { SITE_COUNT } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The last site: four clears away from being reachable in play. */
const SITE = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("opens a locked site without clearing any site before it", async () => {
  await h.debug.reset();
  const before = await h.snapshot();
  assertTrue(
    before.cleared.every((one) => one === false),
    "every site uncleared after a reset, which is what makes site 5 locked",
  );

  await h.debug.openSite(SITE);
  const opened = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    opened.siteIndex,
    SITE,
    `siteIndex after openSite(${SITE}) on a session that has cleared nothing`,
  );
  assertLength(opened.cleared, SITE_COUNT, "the cleared marks, one per site");
  assertTrue(
    opened.cleared.every((one) => one === false),
    "every site still uncleared, openSite reaching a locked site rather than " +
      "unlocking its way there (specs/instrumentation.md)",
  );
});
