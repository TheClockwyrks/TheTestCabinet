// assets/mount-model-at-each-anchor — a mount stands at every anchor the site
// fixes, and at no other lattice node.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … a mount at each anchor …". specs/world.md makes the anchors the site's
// own — "each site fixes its anchor nodes" — so the set of places a mount belongs
// is a fact about the open site and nothing else, and a node that is not an
// anchor owes no mount.
//
// THE SITE WITH THE MOST ANCHORS, because a build that drew one fixture, or a
// fixture at the origin, or one at each of a fixed four, has to be told from a
// build that draws one at each of the site's own. The reading is both halves of
// that: every anchor covered, and no placement anywhere else.
//
// WHERE A MODEL IS DRAWN, UNDER AN ENGINE. specs/assets.md has an engine build
// load each model "through the engine's own asset loader under its asset root",
// so a model on screen is a `ModelComponent` the world holds. `drawnFromModel`
// answers the placements of one committed file — it decodes that file for itself
// through the same loader and matches a component's model against it by contents,
// so a subject drawn from another subject's file does not answer — and
// `drawnModelBox` answers the box each placement FILLS: the model's own extent,
// scaled and turned and stood where the component stands. The component's
// transform is the model's origin, which an exporter is free to put at a corner,
// so the box is what "where it is drawn" means.
//
// THE ENGINELESS PROJECT DECIDES THIS BY SERVING THE FILE WITH ANOTHER MODEL'S
// BYTES and reading which pixels change. There is no rasterizer here —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so the reading is the picture's contents rather than its
// pixels.
//
// THE WORLD IS THE SITE'S ANCHORS AND NOTHING ELSE: `clearAll` leaves no
// structure, no loads and no obstacles, so nothing else in the yard is a subject
// a mount could belong to.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertTrue } from "../assert";
import { SITES } from "../constants";
import {
  clearAll,
  createHarness,
  drawnFromModel,
  drawnModelBox,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The subject's produced model, under the asset root specs/assets.md fixes. */
const MODEL = "models/mount.glb";

/** The site with the most anchors, so the count itself has to be read. */
const SITE = SITES.reduce(
  (best, site, index) =>
    site.anchors.length > SITES[best]!.anchors.length ? index : best,
  0,
);

/**
 * How far outside the box a model fills the point it is drawn at may stand.
 *
 * specs/assets.md sizes each model only "about" its figure and says of the part
 * figures that they "are the intent, not a tolerance", so a build is free to
 * sculpt a block a little short of the point it is drawn around. A quarter of a
 * unit is two voxels at `VOXELS_PER_UNIT` (`8`), and far short of
 * `LATTICE_PITCH` (`2`), so a model drawn at the neighbouring node does not
 * answer.
 */
const SLACK = 0.25;

/** Whether the box `box` covers the point `at`, within `SLACK`. */
function covers(box: { min: Vec3; max: Vec3 } | null, at: Vec3): boolean {
  return (
    box !== null &&
    at.x >= box.min.x - SLACK &&
    at.x <= box.max.x + SLACK &&
    at.y >= box.min.y - SLACK &&
    at.y <= box.max.y + SLACK &&
    at.z >= box.min.z - SLACK &&
    at.z <= box.max.z + SLACK
  );
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a mount at each of the site's anchors and at no other node", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const anchors: readonly Vec3[] = SITES[SITE]!.anchors;
  assertGreaterThan(
    anchors.length,
    1,
    "the site this point reads to fix more than one anchor, so a fixture at " +
      "each of them is told from a fixture at one place (specs/world.md)",
  );
  assertEqual(
    (await h.snapshot()).site.anchors.length,
    anchors.length,
    "the anchors the open site reports, against the ones specs/sites.md " +
      "fixes for it",
  );

  const placed = await drawnFromModel(h, MODEL);
  const boxes = placed.map((one) => drawnModelBox(one));

  for (const anchor of anchors) {
    assertTrue(
      boxes.some((box) => covers(box, anchor)),
      `the mount model drawn over the anchor (${anchor.x}, ${anchor.y}, ` +
        `${anchor.z}): "a mount at each anchor" (specs/assets.md). It is ` +
        `drawn at ${JSON.stringify(boxes.map((box) => box?.centre))}`,
    );
  }

  const stray = boxes.filter(
    (box) => !anchors.some((anchor) => covers(box, anchor)),
  );
  assertEqual(
    stray.length,
    0,
    "the mount model drawn at the site's anchors and NOWHERE ELSE (\"a mount " +
      'at each anchor", specs/assets.md): it is also drawn at ' +
      JSON.stringify(stray.map((box) => box?.centre)),
  );

  await h.capture("anchors", "A mount at each of the site's anchors");
});
