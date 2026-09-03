// sites/site-6-anchors — Site 6 is anchored to the nine ground nodes it was
// authored with.
//
// specs/sites.md § Site 6 — Heavy Haul gives the site's row
// `Anchors | (0,0,0), (2,0,0), (4,0,0), (0,0,2), (2,0,2), (4,0,2), (0,0,4),
// (2,0,4), (4,0,4)` — the three-by-three block of ground nodes — and § The site
// table says `SITES` carries each site's anchors "exactly as this file states
// them". specs/world.md's frame puts all nine on the ground, y = 0, which is
// what an anchor is: "lattice nodes on the ground where the structure is fixed
// to the earth".
//
// THE WIDE BASE IS THIS SITE'S ANSWER TO ITS LOAD. An anchor node "is held
// immovable" in the solve (specs/world.md, specs/statics.md) and is "the one
// kind of support the structure has", so the nine nodes are what lets a crane
// carry "the heaviest load in the game" — a `120` drum — without folding. A site
// that carried the four-node base of the sites before it would fold a conforming
// crane; one that carried a tenth node would stand a crane no conforming site
// would.
//
// THE READING IS THE SITE AS IT OPENS. Anchors are authored data rather than a
// run outcome, so the scenario is `openSite` and one snapshot: nothing is built,
// nothing is emptied, nothing ticks. Emptying the yard here would be posing
// around the very data the point reads.
//
// THE ORDER IS NOT ASSERTED. The specification fixes WHICH nine nodes are
// anchors and says nothing a player or a solve could observe about the order the
// list reports them in, so this decides the set: nine entries, each of the nine
// nodes present, and — since nine distinct nodes cannot fit in nine slots twice —
// none repeated and no tenth node smuggled in.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertLength } from "../assert";
import { createHarness, openSite, type Harness, type Vec3 } from "../harness";

const SITE = 5;

/** specs/sites.md § Site 6 — Heavy Haul, the `Anchors` row. */
const ANCHORS: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 0, y: 0, z: 2 },
  { x: 2, y: 0, z: 2 },
  { x: 4, y: 0, z: 2 },
  { x: 0, y: 0, z: 4 },
  { x: 2, y: 0, z: 4 },
  { x: 4, y: 0, z: 4 },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("anchors Site 6 at the nine ground nodes the specification names", async () => {
  await openSite(h, SITE);
  await h.advance(1);
  await h.capture("anchors", "Site 6's anchor nodes on the yard floor");

  const { site } = await h.snapshot();
  // Read as the three coordinates the specification fixes, so a build that
  // carries more on an anchor than a position is graded on the position.
  const anchors = site.anchors.map(({ x, y, z }) => ({ x, y, z }));

  assertLength(
    anchors,
    ANCHORS.length,
    "the anchors Site 6 carries (specs/sites.md § Site 6 — Heavy Haul)",
  );
  for (const node of ANCHORS) {
    assertContains(
      anchors,
      node,
      "Site 6's anchors (specs/sites.md § Site 6 — Heavy Haul)",
    );
  }
});
