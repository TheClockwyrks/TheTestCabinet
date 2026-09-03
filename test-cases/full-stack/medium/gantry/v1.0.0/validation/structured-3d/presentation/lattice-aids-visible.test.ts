// presentation/lattice-aids-visible — the build screen draws the buildable
// lattice as a visible aid.
//
// specs/overview.md § Visual design, the row for the lattice: "On the build
// screen, the buildable lattice and the envelope's extent are visible aids, and
// the picked node under the pointer is highlighted." specs/structure.md fixes
// where the lattice nodes are: every point of the site's envelope whose
// coordinates are multiples of `LATTICE_PITCH` (`2`).
//
// SO WHAT IS DECIDED IS THAT THE NODES ARE MARKED. A player places a member by
// clicking a node, and a build that drew nothing at them would leave the player
// clicking at an empty yard. What the mark LOOKS like is the build's — a point, a
// cross, a wire cell — so nothing here reads a colour or a shape.
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
// A NODE IS MARKED WHEN SOMETHING DRAWN REACHES IT. A point cloud puts a vertex
// on the node, a wire grid runs its segment ends through it, and a cell drawn
// around it has corners on its neighbours — so the reading is a vertex within a
// short reach of the node, and the reach is a tenth of `LATTICE_PITCH`, far too
// short to reach the next node along.
//
// SIX NODES SPREAD THROUGH THE ENVELOPE, and all six have to be marked: a build
// that drew an aid at the origin alone, or only along the ground, fails on the
// ones it missed. They are read on an EMPTIED yard with the pointer parked off
// every node, so nothing found is a member, a load, or the picked node's own
// highlight.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull, assertTrue } from "../assert";
import { LATTICE_PITCH, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  drawnObjects,
  openSite,
  type DrawnObject,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** Six buildable nodes, spread through the site's envelope. */
const NODES: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 4, y: 0, z: -4 },
  { x: -4, y: 0, z: 4 },
  { x: 0, y: 4, z: 0 },
  { x: 4, y: 8, z: 4 },
  { x: -8, y: 2, z: -8 },
];

/** How near something drawn must come to a node to have marked it. */
const REACH = LATTICE_PITCH / 10;

/** Where the pointer is parked: a stage corner, over no node. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/** Whether any drawn object has a vertex within `reach` of `at`. */
function drawnAt(
  objects: readonly DrawnObject[],
  at: Vec3,
  reach: number,
): boolean {
  return objects.some((object) => {
    const box = object.box;
    if (box === null) return false;
    // The box first: walking a lattice of a thousand points for every node
    // would be the most expensive thing this file did, and an object whose box
    // does not reach the point has no vertex that does.
    if (
      at.x < box.min.x - reach ||
      at.x > box.max.x + reach ||
      at.y < box.min.y - reach ||
      at.y > box.max.y + reach ||
      at.z < box.min.z - reach ||
      at.z > box.max.z + reach
    ) {
      return false;
    }
    return object
      .points()
      .some(
        (point) =>
          Math.hypot(point.x - at.x, point.y - at.y, point.z - at.z) <= reach,
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

it("marks the buildable lattice nodes on the build screen", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.screen === "build",
    "the build screen, which is where the lattice is an aid (specs/ui.md)",
  );
  assertNull(
    posed.pick.node,
    "no node picked under the parked pointer, so nothing here is the picked " +
      "node's highlight rather than the lattice aid (specs/controls.md)",
  );

  const objects = drawnObjects(h);
  await h.capture("lattice", "The lattice aid on the empty build screen");

  const missing = NODES.filter((node) => !drawnAt(objects, node, REACH));
  assertTrue(
    missing.length === 0,
    `every one of the ${NODES.length} buildable lattice nodes read to carry ` +
      `something drawn within ${REACH} of it, since "the buildable lattice ` +
      "and the envelope's extent are visible aids\" on the build screen " +
      "(specs/overview.md) — nothing stood at " +
      missing.map((node) => `(${node.x}, ${node.y}, ${node.z})`).join(", "),
  );
});
