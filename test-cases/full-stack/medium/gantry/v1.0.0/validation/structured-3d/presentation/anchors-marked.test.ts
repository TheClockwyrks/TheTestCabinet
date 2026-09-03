// presentation/anchors-marked — a site's anchor nodes are marked in the yard,
// distinctly from the ordinary lattice around them.
//
// specs/overview.md § Visual design, the row for anchors and pads: "Anchor
// points, each load's starting position, and each pad's footprint and required
// yaw are marked so a site is readable before anything is built." specs/world.md
// makes the anchors the site's own — "each site fixes its anchor nodes" — and
// specs/structure.md makes them the nodes a structure has to reach the ground
// through, so a player who cannot see them cannot read the site.
//
// DISTINCTLY FROM THE ORDINARY LATTICE, which is the whole of the requirement: an
// anchor is already a lattice node and already carries the lattice aid, so a
// build that drew nothing more at an anchor has not marked it. The reading is
// therefore a comparison — what is drawn at an anchor against what is drawn at an
// ordinary ground node of the same lattice — and what is asserted is that the
// anchor carries something the ordinary node does not.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there.
//
// NOTHING IS FOUND BY NAME. What a build calls an object, which component it
// reaches for, and what colour it paints with are all the build's; what a check
// finds an object by is WHERE IT IS and WHAT SHAPE IT HAS.
//
// AND IT IS READ ON AN EMPTIED YARD with the pointer parked off every node, so
// nothing found is a member, a mount, a load, or the picked node's own highlight.
// The site is the one with the most anchors, so a build that marked one and not
// the rest is caught.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNull, assertTrue } from "../assert";
import { LATTICE_PITCH, SITES, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  type DrawnObject,
  type Harness,
  type Vec3,
} from "../harness";

/** The site with the most anchors, so marking one of them is not enough. */
const SITE = SITES.reduce(
  (best, site, index) =>
    site.anchors.length > SITES[best]!.anchors.length ? index : best,
  0,
);

/**
 * How far outside what it drew an object may stand from the node it marks.
 *
 * A tenth of `LATTICE_PITCH` (`2`), which is room for a mark bedded a hair off
 * the ground so it does not fight the floor for the same pixels, and far too
 * short to reach the next node along.
 */
const REACH = LATTICE_PITCH / 10;

/** Where the pointer is parked: a stage corner, over no node. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/**
 * Every drawn object standing over `at`, within `reach`.
 *
 * The box rather than a vertex, because a mark is a SHAPE around the node rather
 * than a point on it: a ring drawn at an anchor puts its vertices on its own
 * circumference and none at the middle, and so does a square, a cross, or a
 * fixture standing there. What every one of them has in common is that the node
 * is inside what was drawn.
 */
function drawnAt(
  objects: readonly DrawnObject[],
  at: Vec3,
  reach: number,
): DrawnObject[] {
  return objects.filter((object) => {
    const box = object.box;
    return (
      box !== null &&
      at.x >= box.min.x - reach &&
      at.x <= box.max.x + reach &&
      at.y >= box.min.y - reach &&
      at.y <= box.max.y + reach &&
      at.z >= box.min.z - reach &&
      at.z <= box.max.z + reach
    );
  });
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks every anchor apart from the ordinary lattice around it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const posed = await h.snapshot();
  assertNull(
    posed.pick.node,
    "no node picked under the parked pointer, so nothing read here is the " +
      "picked node's highlight (specs/controls.md)",
  );
  const anchors = posed.site.anchors;
  assertGreaterThan(
    anchors.length,
    1,
    `the anchors specs/sites.md gives ${posed.site.name}`,
  );

  // An ordinary ground node of the same lattice, inside the envelope and not an
  // anchor: what a node that is NOT an anchor carries.
  const plain = groundNodes(posed.site.envelope).find(
    (node) =>
      !anchors.some(
        (anchor) =>
          anchor.x === node.x && anchor.y === node.y && anchor.z === node.z,
      ),
  );
  assertTrue(
    plain !== undefined,
    "an ordinary ground lattice node the site does not anchor, which is what " +
      "an anchor's own mark is read against",
  );

  const objects = drawnObjects(h);
  await h.capture("anchors", "The site's anchors marked in the yard");

  const ordinary = new Set(drawnAt(objects, plain!, REACH));
  const unmarked = anchors.filter(
    (anchor) =>
      !drawnAt(objects, anchor, REACH).some((object) => !ordinary.has(object)),
  );

  assertTrue(
    unmarked.length === 0,
    `every one of the ${anchors.length} anchors to carry something drawn at ` +
      `it that the ordinary lattice node (${plain!.x}, ${plain!.y}, ` +
      `${plain!.z}) does not, since "Anchor points … are marked so a site is ` +
      'readable before anything is built" (specs/overview.md) — nothing set ' +
      "apart " +
      unmarked
        .map((anchor) => `(${anchor.x}, ${anchor.y}, ${anchor.z})`)
        .join(", "),
  );
});

/** Every ground-level lattice node inside the envelope, in lattice order. */
function groundNodes(envelope: { min: Vec3; max: Vec3 }): Vec3[] {
  const out: Vec3[] = [];
  const from = (value: number): number =>
    Math.ceil(value / LATTICE_PITCH) * LATTICE_PITCH;
  for (let x = from(envelope.min.x); x <= envelope.max.x; x += LATTICE_PITCH) {
    for (
      let z = from(envelope.min.z);
      z <= envelope.max.z;
      z += LATTICE_PITCH
    ) {
      out.push({ x, y: 0, z });
    }
  }
  return out;
}
