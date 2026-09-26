// sites/site-5-anchors — Site 5 is anchored to the four ground nodes it was
// authored with.
//
// specs/sites.md § Site 5 — High Shelf gives the site's row
// `Anchors | (0,0,0), (2,0,0), (0,0,2), (2,0,2)`, and § The site table says
// `SITES` carries each site's anchors "exactly as this file states them".
// specs/world.md's frame puts all four on the ground, y = 0, which is what an
// anchor is: "lattice nodes on the ground where the structure is fixed to the
// earth".
//
// THE ANCHORS ARE THE SITE'S FOUNDATION, so this is not bookkeeping: an anchor
// node "is held immovable" in the solve (specs/world.md, specs/statics.md) and
// is "the one kind of support the structure has", so a site carrying a fifth
// anchor stands a crane a conforming site would fold, and a site missing one
// folds a crane a conforming site stands. High Shelf asks for a container lifted
// onto a platform at `y` `6`, and the four-node base it is authored with is the
// whole of what that lift is levered against.
//
// THE READING IS THE SITE AS IT OPENS. Anchors are authored data rather than a
// run outcome, so the scenario is `openSite` and one snapshot: nothing is built,
// nothing is emptied, nothing ticks. Emptying the yard here would be posing
// around the very data the point reads.
//
// THE ORDER IS NOT ASSERTED. The specification fixes WHICH four nodes are
// anchors and says nothing a player or a solve could observe about the order the
// list reports them in, so this decides the set: four entries, each of the four
// nodes present, and — since four distinct nodes cannot fit in four slots twice —
// none repeated and no fifth node smuggled in.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

const SITE = 4;

/** specs/sites.md § Site 5 — High Shelf, the `Anchors` row. */
const ANCHORS: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 0, y: 0, z: 2 },
  { x: 2, y: 0, z: 2 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("anchors Site 5 at the four ground nodes the specification names", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("anchors", "Site 5's anchor nodes on the yard floor");

  const { site } = await h.snapshot();
  // Read as the three coordinates the specification fixes, so a build that
  // carries more on an anchor than a position is graded on the position.
  const anchors = site.anchors.map(({ x, y, z }) => ({ x, y, z }));

  assertLength(
    anchors,
    ANCHORS.length,
    "the anchors Site 5 carries (specs/sites.md § Site 5 — High Shelf)",
  );
  for (const node of ANCHORS) {
    assertContains(
      anchors,
      node,
      "Site 5's anchors (specs/sites.md § Site 5 — High Shelf)",
    );
  }
});
