// instrumentation/clear-best-removes-a-score — clearBest leaves a site with no
// recorded score.
//
// `specs/instrumentation.md` § The run and the screens: `clearBest(index)`
// "Returns site `index` to having no recorded score", and § Snapshot shape reports
// the score as `best[index]`, "`[{ cost, time } | null]`, one per site". No score
// is `null`, so that is the reading.
//
// The site is given a score first, through `setBest(index, cost, time)` —
// "Records `{ cost, time }` as site `index`'s best score, whatever it held" —
// because clearing a site that never had one would pass on a build whose
// `clearBest` did nothing at all. The figures are site 2's par (`specs/sites.md`),
// which is nothing more than a plausible score to remove; what is read is only
// that it went. Nothing else is posed: a best score is a session fact, and the
// session a reset leaves has no score on any site.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull } from "../assert";
import { SITES } from "../constants";
import { createHarness, type Harness } from "../harness";

/** The site whose score is recorded and then removed. */
const SITE = 1;

/** A plausible score to remove: site 2's par (specs/sites.md). */
const PAR = SITES[SITE]!.par;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns a site carrying a score to having none", async () => {
  await h.debug.setBest(SITE, PAR.cost, PAR.time);
  const recorded = await h.snapshot();
  assertNotNull(
    recorded.best[SITE],
    `the score setBest(${SITE}, ${PAR.cost}, ${PAR.time}) recorded, which is ` +
      "the scenario this point rests on",
  );

  await h.debug.clearBest(SITE);
  const cleared = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertNull(
    cleared.best[SITE],
    `best[${SITE}] after clearBest(${SITE}) (specs/instrumentation.md)`,
  );
});
