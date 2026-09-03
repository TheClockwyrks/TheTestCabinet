// instrumentation/reset-empties-every-stored-structure — a reset leaves nothing
// built on any site.
//
// `specs/instrumentation.md` § The run and the screens: "`reset` restores every
// field the snapshot reports to its title-screen value, bar one: […] every site's
// stored structure and tape emptied". `specs/state.md` § The session says what is
// being emptied: "Per site: the structure and the tape authored on it, which
// persist across visits for the session", and § Snapshot shape says a stored one
// is read by opening its site — "A site that is not open reports the structure and
// tape stored on it through `structure` and `program` once it is opened."
//
// So the check builds on TWO sites and reads both back after the reset: a build
// that emptied only the open site's structure would pass on one. Each site is given
// a member, a ring and a counterweight, which is every part `structure` reports,
// and the reading afterwards is that all three are gone and `nextMemberId` is back
// at `0` — "which `clearStructure` returns to `0` and which no removal gives
// back", the same value a site with nothing built carries.
//
// The parts are the smallest arrangement that passes `specs/structure.md`: the ring
// stands at `(0, 2, 0)`, whose `y` is not `0`, "since the ring sits on a tower, not
// on the ground"; the member runs from the ground anchor below it to its
// bottom-flange node, joining tower to tower; and the counterweight sits on `(0, 0,
// 0)`, "a node a member ends at". The yard is emptied first, so nothing standing in
// it can refuse a placement. What the tape stores is its own point.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** Two sites, so a build that emptied only the open one is caught. */
const SITES_BUILT = [0, 2] as const;

/** The ring's base corner: a lattice node whose y is not 0. */
const RING = { x: 0, y: 2, z: 0 };

/** A ground anchor, and the bottom-flange node above it. */
const FOOT = { x: 0, y: 0, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("empties the structure stored on every site", async () => {
  for (const site of SITES_BUILT) {
    await openSite(h, site);
    await clearAll(h);
    await h.debug.setRing(RING.x, RING.y, RING.z);
    await h.debug.addMember(
      FOOT.x,
      FOOT.y,
      FOOT.z,
      RING.x,
      RING.y,
      RING.z,
      "strut",
    );
    await h.debug.addCounterweight(FOOT.x, FOOT.y, FOOT.z);
    const built = await h.snapshot();
    assertNotNull(
      built.structure.ring,
      `the ring standing on site ${site + 1}, which is the scenario this ` +
        "point rests on",
    );
    assertLength(
      built.structure.members,
      1,
      `the member standing on site ${site + 1}`,
    );
    assertLength(
      built.structure.counterweights,
      1,
      `the counterweight standing on site ${site + 1}`,
    );
  }

  await h.debug.reset();

  for (const site of SITES_BUILT) {
    await h.debug.openSite(site);
    const { structure } = await h.snapshot();
    if (site === SITES_BUILT[SITES_BUILT.length - 1]) {
      await h.advance(1);
      await h.capture("state", "The driven state this point decides");
    }
    assertLength(
      structure.members,
      0,
      `the members stored on site ${site + 1} after a reset`,
    );
    assertNull(
      structure.ring,
      `the ring stored on site ${site + 1} after a reset`,
    );
    assertLength(
      structure.counterweights,
      0,
      `the counterweights stored on site ${site + 1} after a reset`,
    );
    assertEqual(
      structure.nextMemberId,
      0,
      `nextMemberId on site ${site + 1} after a reset, the value a site with ` +
        "nothing built carries (specs/instrumentation.md)",
    );
  }
});
