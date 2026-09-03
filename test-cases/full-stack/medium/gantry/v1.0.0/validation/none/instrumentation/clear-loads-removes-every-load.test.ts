// instrumentation/clear-loads-removes-every-load — `clearLoads` empties the open
// site's yard of loads.
//
// `specs/instrumentation.md` § The site: "`clearLoads` — Removes every load from
// the open site", and it is half of what lets a scenario "hold only what it is
// about: a caller clears the loads and the obstacles and adds back exactly the ones
// its requirement concerns". EVERY load: a build that removed one, or that removed
// only the loads a check had itself added, leaves a bystander standing in every
// scenario that thought it had an empty yard.
//
// SITE 5, `High Shelf`, IS THE SITE THIS IS DECIDED ON. It is the site whose
// authored yard carries more than one load — two, of two classes
// (`specs/sites.md`) — so "every load" is a reading with something to say, and they
// are the site's own rather than any this check placed, which is the set a
// scenario actually has to get rid of.
//
// The obstacle it also carries is read afterwards, because `clearLoads` is stated
// as removing loads: the platform site 5 is authored with is what says the call
// emptied the yard of loads rather than emptying the yard.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { SITES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `High Shelf`, counted from 0: two authored loads and one authored obstacle. */
const SITE_INDEX = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the open site's yard of every load it carried", async () => {
  await openSite(h, SITE_INDEX);
  const before = await h.snapshot();

  await h.debug.clearLoads();

  const after = await h.snapshot();
  await h.capture("state", "the yard clearLoads emptied of loads");

  assertGreaterThan(
    before.site.loads.length,
    1,
    `the loads site ${SITE_INDEX + 1} opens with (specs/sites.md)`,
  );
  assertLength(after.site.loads, 0, "the loads clearLoads leaves");
  assertDeepEqual(
    after.site.obstacles,
    SITES[SITE_INDEX]?.obstacles,
    "the obstacles clearLoads leaves alone: it removes loads and no more " +
      "(specs/instrumentation.md)",
  );
});
