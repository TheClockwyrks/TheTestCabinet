// assets/mount-model-at-each-anchor — a mount stands at every anchor the site
// fixes, and at no other node.
//
// `specs/assets.md` § The models says where each produced model is drawn: "The
// game draws each model wherever its subject is: … a mount at each anchor …",
// the mount being "an anchor's ground fixture". The anchors are the SITE's, given
// by `specs/sites.md` and reported as `anchors` in the snapshot, so what this
// compares is the build's own list against the build's own drawing.
//
// BOTH DIRECTIONS, because one is not the requirement. A build that draws a mount
// at one anchor and none at the rest satisfies "a mount at each anchor" only for
// that one; a build that scatters mounts over the lattice draws them where no
// subject is. So the count must match and every anchor must have one.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  entriesNear,
  entriesOf,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** How far a mount may stand from the anchor it marks. */
const REACH = 1;

it("draws one mount at each of the site's anchors and no others", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setScreen("build");
  await h.advance(1);

  const { site } = await h.snapshot();
  const anchors = site.anchors;
  const drawn = await h.drawn();
  const mounts = entriesOf(drawn, "model", "mount");

  await h.capture("anchors", "The mounts standing at the site's anchors");

  assertEqual(
    mounts.length,
    anchors.length,
    `mounts drawn against the ${anchors.length} anchor(s) the site fixes ` +
      "(specs/sites.md)",
  );
  for (const anchor of anchors) {
    assertTrue(
      entriesNear(drawn, anchor, REACH, "model", "mount").length > 0,
      `a mount drawn within ${REACH} unit of the anchor at ` +
        `(${anchor.x}, ${anchor.y}, ${anchor.z})`,
    );
  }
});
