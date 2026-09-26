// check/check-reports-the-sites-budget — the check reports the open site's
// budget.
//
// specs/structure.md § The static check reports "The crane's cost, and the site's
// budget it is measured against", and § Cost and the budget says whose budget
// that is: "Each site fixes a budget, and the cost never exceeds it."
// specs/instrumentation.md fixes where it is read from — "A site's name,
// envelope, anchors, budget, and par are the site's own figures, read by the open
// site's index against `specs/sites.md` rather than carried anywhere" — so it
// answers to the site and to nothing the crane does.
//
// TWO SITES, AND NEITHER CARRIES A STRUCTURE. specs/sites.md gives Turnabout
// (index `1`) a budget of `3600` and Heavy Haul (index `5`) one of `6000`. With
// the structure empty on both, the only thing that differs between the two
// readings is which site is open, so a build that reported a fixed figure, the
// first site's, or something read off the crane fails on one reading or the
// other. Each reading is checked against the same site's `site.budget` as well,
// which is where specs/state.md has the editor read the budget it shows.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { SITES } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const FIRST = 1;
const SECOND = 5;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads 3600 on Turnabout and 6000 on Heavy Haul", async () => {
  await openSite(h, FIRST);
  await clearAll(h);
  const turnabout = await h.check();
  const onTurnabout = await h.snapshot();

  await openSite(h, SECOND);
  await clearAll(h);
  const heavyHaul = await h.check();
  const onHeavyHaul = await h.snapshot();

  await h.advance(1);
  await h.capture(
    "budget-and-site-budget-from-both-readings",
    "budget and site.budget from both readings.",
  );

  assertLength(
    onTurnabout.structure.members,
    0,
    "the structure standing on the first site, so the budget answers to the " +
      "site alone",
  );
  assertLength(
    onHeavyHaul.structure.members,
    0,
    "the structure standing on the second site, so the budget answers to the " +
      "site alone",
  );
  assertEqual(
    turnabout.budget,
    SITES[FIRST]!.budget,
    `the budget site index ${FIRST} fixes (specs/sites.md § Site 2)`,
  );
  assertEqual(
    turnabout.budget,
    onTurnabout.site.budget,
    "the budget the check reports, against the open site's own",
  );
  assertEqual(
    heavyHaul.budget,
    SITES[SECOND]!.budget,
    `the budget site index ${SECOND} fixes (specs/sites.md § Site 6)`,
  );
  assertEqual(
    heavyHaul.budget,
    onHeavyHaul.site.budget,
    "the budget the check reports, against the open site's own",
  );
});
