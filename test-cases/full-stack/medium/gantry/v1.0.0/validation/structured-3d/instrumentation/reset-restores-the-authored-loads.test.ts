// instrumentation/reset-restores-the-authored-loads — a reset puts the open
// site's loads back to the ones `specs/sites.md` gives it.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: … every site's
// stored structure and tape emptied, the open site's loads and obstacles back to
// the ones `specs/sites.md` gives it, …". The same sentence says which site is
// open afterwards — "site `0` open" — so the yard read after the reset is site
// 1's, `First Lift`: one `crate` of mass `40`, from `(10, 2, 0)` yaw `0` to
// `(0, 2, 10)` yaw `0` (`specs/sites.md`).
//
// THE POSED YARD IS NOTHING LIKE THE AUTHORED ONE, so a reset that left it alone
// cannot be mistaken for one that restored it: a different class, a different
// mass, a different starting pose and a different pad. `addOneLoad` clears the
// yard and adds that one load through the site poses, which "refuse nothing and
// change nothing that is built".
//
// The whole authored list is compared at once, rather than field by field,
// because the requirement is that the yard is the site's own again.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { SITES } from "../constants";
import { addOneLoad, createHarness, openSite, type Harness } from "../harness";

/** Site 1's authored yard, from `specs/sites.md`. */
const AUTHORED = SITES[0]?.loads ?? [];

/** Nothing the site authors: another class, mass, starting pose and pad. */
const POSED = {
  cls: "drum" as const,
  mass: 120,
  from: { x: -6, y: 3, z: 4, yaw: 90 },
  to: { x: 4, y: 3, z: -6, yaw: 180 },
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("puts the open site's authored loads back", async () => {
  await openSite(h, 0);
  await addOneLoad(h, POSED.cls, POSED.mass, POSED.from, POSED.to);
  const posed = (await h.snapshot()).site.loads;
  assertLength(posed, 1, "the yard the pose left, before the reset");
  assertEqual(
    posed[0]?.class,
    POSED.cls,
    "the class of the load the pose left, before the reset",
  );

  await h.debug.reset();
  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("loads", "The loads a reset puts back in the yard");

  assertEqual(
    s.siteIndex,
    0,
    "the site a reset leaves open, whose loads are read",
  );
  assertDeepEqual(
    s.site.loads,
    AUTHORED,
    "the loads a reset puts back (specs/sites.md, site 1)",
  );
});
