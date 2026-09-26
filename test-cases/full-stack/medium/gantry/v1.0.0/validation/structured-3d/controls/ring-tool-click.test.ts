// controls/ring-tool-click — under the ring tool a click places the ring by its
// base corner at the picked node.
//
// `specs/controls.md` § The build tools: "Ring: a click places the ring by its
// base corner at the picked node." `specs/structure.md` says what that corner is:
// the ring "is placed by its base corner, a lattice node `(x, y, z)`, and
// occupies eight nodes", so the reading that decides the point is the corner the
// snapshot reports against the node the click was made at.
//
// THE CLICK IS A REAL CLICK through the pointer rather than a posed `setRing`:
// the point is the tool's click, and the pose is described by it
// (`specs/instrumentation.md`) rather than the other way round. It lands on the
// node's projected point, asked of the build because `specs/controls.md` fixes
// how a click picks and not how the yard is drawn.
//
// NOTHING CAN REFUSE THE PLACEMENT. The structure is emptied first, so the crane
// has no ring yet and, with no members, no path of members can join a flange node
// to an anchor. `(0, 4, 0)` puts the eight flange nodes at `y = 4` and `y = 6`
// over the square `x` `0..2` by `z` `0..2`, every one inside site 1's envelope
// (`x -8..12`, `y 0..16`, `z -8..12`); the corner's `y` is not `0`, since "the
// ring sits on a tower, not on the ground"; and `RING_COST` (`300`) is far inside
// the site's budget of `3000`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull, assertTrue } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The node the click is made at, which becomes the ring's base corner. */
const NODE: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("places the ring with its base corner at the clicked node", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setTool("ring");

  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the lattice node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);

  const { ring } = (await h.snapshot()).structure;
  await h.advance(1);
  await h.capture("state", "The ring placed by the click's own node");

  assertNotNull(
    ring,
    "the ring a click under the ring tool places (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(ring?.corner),
    JSON.stringify(NODE),
    "the base corner the ring stands by: the node the click picked " +
      "(specs/controls.md)",
  );
});
