// instrumentation/clear-obstacles-removes-every-obstacle — `clearObstacles` empties
// the open site's yard of obstacles.
//
// `specs/instrumentation.md` § The site: "`clearObstacles` — Removes every obstacle
// from the open site." It is the other half of the isolated world every validator
// poses, and the half a strike scenario leans on hardest: a check on a member
// sweeping into an obstacle adds the one obstacle it is about, and an authored
// obstacle left standing would decide that check first.
//
// SITE 5, `High Shelf`, IS THE SITE THIS IS DECIDED ON, because its yard is
// authored with an obstacle at all — `specs/sites.md` gives it the platform the
// container is lifted onto — so the call has something of the site's own to remove
// rather than something this check placed.
//
// The two loads it also carries are read afterwards, because `clearObstacles` is
// stated as removing obstacles: they are what says the call emptied the yard of
// obstacles rather than emptying the yard.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { SITES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** `High Shelf`, counted from 0: one authored obstacle and two authored loads. */
const SITE_INDEX = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the open site's yard of every obstacle it carried", async () => {
  await openSite(h, SITE_INDEX);
  const before = await h.snapshot();

  await h.debug.clearObstacles();

  const after = await h.snapshot();
  await h.capture("state", "the yard clearObstacles emptied of obstacles");

  assertGreaterThan(
    before.site.obstacles.length,
    0,
    `the obstacles site ${SITE_INDEX + 1} opens with (specs/sites.md)`,
  );
  assertLength(after.site.obstacles, 0, "the obstacles clearObstacles leaves");
  assertDeepEqual(
    after.site.loads,
    SITES[SITE_INDEX]?.loads,
    "the loads clearObstacles leaves alone: it removes obstacles and no more " +
      "(specs/instrumentation.md)",
  );
});
