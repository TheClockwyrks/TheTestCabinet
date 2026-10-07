// instrumentation/reset-restores-the-authored-obstacles — a reset puts the open
// site's obstacles back to the ones `specs/sites.md` gives it.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: … the open
// site's loads and obstacles back to the ones `specs/sites.md` gives it, …". The
// same sentence fixes which site that is — "site `0` open" — and `specs/sites.md`
// authors site 1, `First Lift`, "No obstacles". So the obstacle list a reset
// leaves is that site's, which is empty.
//
// A WALL IS POSED INTO THE YARD FIRST, so the empty list read afterwards is one
// the reset produced rather than one that was never disturbed. `addOneObstacle`
// places it through the site poses, which "refuse nothing and change nothing that
// is built", and the box is a solid one standing clear of the anchors so nothing
// about it is marginal.
//
// The list is compared against `specs/sites.md`'s own authored set rather than
// against a literal empty array, so the check states the requirement it is
// deciding: the yard's obstacles are the site's again.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { SITES } from "../constants";
import {
  addOneObstacle,
  createHarness,
  openSite,
  type Harness,
} from "../harness";

/** Site 1's authored obstacles, from `specs/sites.md`: none. */
const AUTHORED = SITES[0]?.obstacles ?? [];

/** A wall the site does not author, standing clear of its four anchors. */
const POSED = { min: { x: 4, y: 0, z: -4 }, size: { x: 2, y: 6, z: 8 } };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the open site's authored obstacles back", async () => {
  await openSite(h, 0);
  await addOneObstacle(h, POSED.min, POSED.size);
  assertLength(
    (await h.snapshot()).site.obstacles,
    1,
    "the obstacle the pose left in the yard, before the reset",
  );

  await h.debug.reset();
  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("obstacles", "The obstacles a reset puts back in the yard");

  assertEqual(
    s.siteIndex,
    0,
    "the site a reset leaves open, whose obstacles are read",
  );
  assertDeepEqual(
    s.site.obstacles,
    AUTHORED,
    "the obstacles a reset puts back (specs/sites.md, site 1)",
  );
});
