// controls/delete-tool-removes-a-counterweight — under the delete tool a click
// within NODE_PICK_PX of a counterweight's node removes that counterweight.
//
// `specs/controls.md` § The build tools: "Delete: a click removes what it picks,
// the nearest in screen distance of a member within `MEMBER_PICK_PX`, a
// counterweight within `NODE_PICK_PX` of its node, or the ring within
// `NODE_PICK_PX` of any of its eight flange nodes. A tie goes to the member, then
// the counterweight, then the ring."
//
// THE WORLD HOLDS A RING AND ONE COUNTERWEIGHT AND NOTHING ELSE. A counterweight
// stands only "on any node the structure uses, a node a member ends at or a
// flange node of the ring" (`specs/structure.md`), so something has to hold it —
// and a member cannot, because a member's projected segment runs through its own
// end nodes and a click there is a tie the MEMBER wins. What the ring leaves is
// the tie between the counterweight and the flange node under it, and the
// specification decides that one for the counterweight. So the reading this check
// takes is the whole of the click's effect: the counterweight is gone and the
// ring, the only other thing the click could have taken, still stands.
//
// The ring's base corner is `(0, 2, 0)`: its eight flange nodes are the four at
// `y = 2` and the four at `y = 4` above them, every one inside site 1's envelope
// (`x -8..12`, `y 0..16`, `z -8..12`), the corner's `y` is not `0`, and at `340`
// the crane is far inside the site's budget of `3000` — so neither pose can be
// refused. The counterweight goes on the top-flange node `(0, 4, 0)`, which no
// other flange node is drawn near, and the click lands on that node's projected
// point, asked of the build because `specs/controls.md` fixes how a click picks
// and not how the yard is drawn.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNotNull,
  assertTrue,
} from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The ring's base corner, one pitch above the ground. */
const RING: Vec3 = { x: 0, y: 2, z: 0 };

/** The top-flange node the counterweight hangs on, and the click's target. */
const NODE: Vec3 = { x: 0, y: 4, z: 0 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("removes the counterweight the click picks, leaving the ring standing", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await h.debug.setRing(RING.x, RING.y, RING.z);
  await h.debug.addCounterweight(NODE.x, NODE.y, NODE.z);

  const posed = await h.snapshot();
  assertNotNull(posed.structure.ring, "the ring the scenario stands on");
  assertLength(
    posed.structure.counterweights,
    1,
    "the counterweight the click is about (specs/structure.md)",
  );

  await h.debug.setTool("delete");
  const at = await h.project(NODE.x, NODE.y, NODE.z);
  assertTrue(
    at.visible,
    `the flange node (${NODE.x}, ${NODE.y}, ${NODE.z}) is drawn on the stage`,
  );
  await h.click(at.x, at.y);

  const s = await h.snapshot();
  await h.advance(1);
  await h.capture("state", "The ring standing with its counterweight deleted");

  assertLength(
    s.structure.counterweights,
    0,
    "the counterweights standing after a delete click on the node one hangs " +
      "on (specs/controls.md)",
  );
  assertNotNull(
    s.structure.ring,
    "the ring after that click: a tie between a counterweight and the ring " +
      "goes to the counterweight (specs/controls.md)",
  );
  assertEqual(
    JSON.stringify(s.structure.ring?.corner),
    JSON.stringify(RING),
    "the corner the ring still reads",
  );
});
