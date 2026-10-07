// instrumentation/open-site-restores-authored-loads — a site opened carries the
// yard specs/sites.md gives it.
//
// `specs/instrumentation.md` § The site: "The loads a run carries are the ones
// standing when it starts, index-aligned with them, and `openSite` and `reset`
// both put the site's authored set back." `specs/state.md` § What a site opening
// does says the same as an effect: opening a site "fills the open site with copies
// of that site's loads and obstacles".
//
// The scenario is a yard that has been emptied and a site opened onto it again,
// because that is the only arrangement in which the restoration is visible: the
// site poses are the one thing that can leave a yard other than its authored set,
// and they reach only the open site. Site `2` is the site chosen because
// `specs/sites.md` gives it both a load and an obstacle — "Site 3 — Over the Wall"
// — so one opening decides both halves of the same sentence.
//
// What is compared is `SITES[2]`, the authored set that file states, and not
// anything the reference put in the yard.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength } from "../assert";
import { SITES } from "../constants";
import { createHarness, emptyYard, openSite, type Harness } from "../harness";

/** The site specs/sites.md gives both a load and an obstacle. */
const SITE = 2;

const AUTHORED = SITES[SITE]!;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the authored loads and obstacles back over an emptied yard", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  const emptied = await h.snapshot();
  assertLength(
    emptied.site.loads,
    0,
    "the loads clearLoads removed, which is the scenario this point rests on",
  );
  assertLength(
    emptied.site.obstacles,
    0,
    "the obstacles clearObstacles removed, which is the scenario this point " +
      "rests on",
  );

  await h.debug.openSite(SITE);
  const reopened = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertDeepEqual(
    reopened.site.loads,
    AUTHORED.loads,
    `the loads openSite(${SITE}) puts back (specs/sites.md)`,
  );
  assertDeepEqual(
    reopened.site.obstacles,
    AUTHORED.obstacles,
    `the obstacles openSite(${SITE}) puts back (specs/sites.md)`,
  );
});
