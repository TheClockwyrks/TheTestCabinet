// sites/site-3-anchors — Site 3 is anchored to the four ground nodes it was
// authored with.
//
// specs/sites.md § Site 3 — Over the Wall gives the site's row
// `Anchors | (0,0,0), (2,0,0), (0,0,2), (2,0,2)`, and § The site table says
// `SITES` carries each site's anchors "exactly as this file states them".
// specs/world.md's frame puts all four on the ground, y = 0, which is what an
// anchor is: the lattice node where the structure is fixed to the earth.
//
// THE ANCHORS ARE THE SITE'S FOUNDATION, so this is not bookkeeping: they are
// where specs/statics.md fixes the structure to the earth, so a site carrying a
// fifth anchor stands a crane a conforming site would fold, and a site missing
// one folds a crane a conforming site stands. It matters most on this site,
// whose crane has to reach over a wall from the same four nodes.
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

const SITE = 2;

/** specs/sites.md § Site 3 — Over the Wall, the `Anchors` row. */
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

it("anchors Site 3 at the four ground nodes the specification names", async () => {
  await openSite(h, SITE);
  await h.capture("anchors", "Site 3's anchor nodes on the yard floor");

  const { site } = await h.snapshot();
  // Read as the three coordinates the specification fixes, so a build that
  // carries more on an anchor than a position is graded on the position.
  const anchors = site.anchors.map(({ x, y, z }) => ({ x, y, z }));

  assertLength(
    anchors,
    ANCHORS.length,
    "the anchors Site 3 carries (specs/sites.md § Site 3 — Over the Wall)",
  );
  for (const node of ANCHORS) {
    assertContains(
      anchors,
      node,
      "Site 3's anchors (specs/sites.md § Site 3 — Over the Wall)",
    );
  }
});
