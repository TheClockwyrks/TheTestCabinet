// controls/delete-tool-removes-the-ring — under the delete tool a click within
// NODE_PICK_PX of one of the ring's flange nodes removes the ring.
//
// `specs/controls.md` § The build tools: "Delete: a click removes what it picks,
// the nearest in screen distance of a member within `MEMBER_PICK_PX`, a
// counterweight within `NODE_PICK_PX` of its node, or the ring within
// `NODE_PICK_PX` of any of its eight flange nodes."
//
// THE RING STANDS ALONE — no member and no counterweight — because the two beat
// it on a tie ("A tie goes to the member, then the counterweight, then the ring")
// and the requirement here is the ring's own pick. What stands afterwards is
// therefore the click's whole effect.
//
// THE CLICK IS NOT ON THE BASE CORNER. `specs/structure.md` gives the ring eight
// flange nodes, "the four nodes `(x, y, z)`, `(x + LATTICE_PITCH, y, z)`,
// `(x, y, z + LATTICE_PITCH)`, and `(x + LATTICE_PITCH, y, z + LATTICE_PITCH)`,
// and the top flange, the same four nodes at `y + LATTICE_PITCH`", and
// `specs/controls.md` says ANY of the eight picks it. `(2, 2, 0)` is the
// bottom-flange node diagonally across from the base corner, so a build that only
// answered to the node it was placed by fails here. The ring's corner is
// `(0, 2, 0)`: every flange node is inside site 1's envelope, the corner's `y` is
// not `0`, and `300` is far inside the budget of `3000`, so the pose is not
// refused.

import { afterEach, beforeEach, it } from "vitest";
import { assertNotNull, assertNull, assertTrue } from "../assert";
import { NODE_PICK_PX } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The ring's base corner. */
const RING: Vec3 = { x: 0, y: 2, z: 0 };

/** The flange node clicked: the bottom flange, across from the base corner. */
const NODE: Vec3 = { x: 2, y: 2, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the ring on a click at one of its flange nodes", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  assertNotNull(
    (await h.snapshot()).structure.ring,
    "the ring the click is about (specs/structure.md)",
  );

  await h.debug.setTool("delete");
  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the flange node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);

  assertNull(
    (await h.snapshot()).structure.ring,
    "the ring after a delete click on a flange node it occupies, inside " +
      `NODE_PICK_PX (${NODE_PICK_PX}) of it (specs/controls.md)`,
  );

  await h.advance(1);
  await h.capture("state", "The yard with the ring deleted");
});
