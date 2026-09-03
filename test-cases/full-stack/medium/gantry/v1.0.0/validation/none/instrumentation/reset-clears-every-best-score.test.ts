// instrumentation/reset-clears-every-best-score — a reset leaves no site with a
// score.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: […] every site
// uncleared with no recorded score". § Snapshot shape reports the scores as
// `best`, "`[{ cost, time } | null]`, one per site", so no score is `null` on all
// `SITE_COUNT` (`6`) of them.
//
// Two sites are given a score first, and two rather than one because the field is
// per site and a build that cleared only the open one would pass with a single
// entry. The figures are those sites' pars (`specs/sites.md`), which is nothing
// more than a plausible score to remove. Whether a site is marked cleared is a
// separate fact — `specs/state.md`: "The two are set independently" — and is its
// own point, so nothing here reads it.

import { afterEach, beforeEach, it } from "vitest";
import { assertLength, assertNotNull, assertTrue } from "../assert";
import { SITE_COUNT, SITES } from "../constants";
import { createHarness, type Harness } from "../harness";

/** Two sites, so a build that cleared only the open one is caught. */
const SCORED = [0, 2] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every site with no recorded score", async () => {
  for (const site of SCORED) {
    const par = SITES[site]!.par;
    await h.debug.setBest(site, par.cost, par.time);
  }
  const recorded = await h.snapshot();
  for (const site of SCORED) {
    assertNotNull(
      recorded.best[site],
      `the score setBest recorded on site ${site + 1}, which is the scenario ` +
        "this point rests on",
    );
  }

  await h.debug.reset();
  const s = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(s.best, SITE_COUNT, "the best scores, one per site");
  assertTrue(
    s.best.every((one) => one === null),
    "every site with no recorded score after a reset " +
      "(specs/instrumentation.md)",
  );
});
