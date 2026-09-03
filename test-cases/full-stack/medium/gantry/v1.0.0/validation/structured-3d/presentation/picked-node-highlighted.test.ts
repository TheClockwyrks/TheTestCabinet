// presentation/picked-node-highlighted — the node a click would take is
// highlighted before the click.
//
// specs/overview.md § Visual design: "On the build screen, the buildable lattice
// and the envelope's extent are visible aids, and the picked node under the
// pointer is highlighted." specs/controls.md fixes which node that is: a node
// pick "considers every lattice node in the envelope that stands in front of the
// camera, projected to the stage; the candidate is the nearest at most
// `NODE_PICK_PX` (`20`) logical pixels from the click", and specs/state.md
// reports it as `pick.node`. Without the highlight a player cannot tell which
// node a click is about to take.
//
// THE READING, UNDER AN ENGINE. There is no rasterizer in this project —
// `validation/host.ts` gives three a WebGL2 context that answers every call and
// draws nothing — so a claim about the yard is made against what the engine WOULD
// draw: `drawnObjects` answers every object the world pass will draw this frame,
// with the box its geometry fills and every one of its vertices, in world units.
// `engine/rendering.md` fixes that the pipeline collects every enabled, visible
// render component on every live actor and draws it, so any build of this case
// that puts something on screen puts it there. `drawnOver` narrows that to what
// stands over one place, and `drawnSignature` turns it into a value two frames
// can be compared by.
//
// NOTHING IS FOUND BY NAME, AND NO COLOUR IS ASSERTED. What a build calls an
// object, which component it reaches for and what it paints with are the
// build's; what a check holds it to is that the drawing over one place changed
// when the game did, and that the drawing elsewhere did not.
//
// THE POINTER IS AIMED BY THE BUILD'S OWN PROJECTION. Where a node is drawn is
// the build's answer, so the pointer is put at `project`'s point for the node
// this reads, and the pick the build reports is checked to BE that node before
// anything is read: a build whose picking is broken fails the picking items, and
// this one grades the highlight.
//
// AND A SECOND NODE IS READ BESIDE IT, so that a build that lit the whole lattice
// under the pointer would fail: what has to change is the drawing over the picked
// node alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LATTICE_PITCH, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  drawnObjects,
  drawnOver,
  drawnSignature,
  nodePoint,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The node the pointer is aimed at, and one it never reaches. */
const AIMED: Vec3 = { x: 6, y: 0, z: -4 };
const CONTROL: Vec3 = { x: -4, y: 0, z: 4 };

/** Where the pointer is parked: a stage corner, over no node. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/** How far outside what it drew an object may stand from the node it marks. */
const REACH = LATTICE_PITCH / 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** What the yard draws over `at` right now. */
function over(at: Vec3): string {
  return drawnSignature(drawnOver(drawnObjects(h), at, REACH));
}

it("highlights the node under the pointer and leaves the rest of the lattice alone", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  assertEqual(
    (await h.snapshot()).pick.node,
    null,
    "no node picked under the parked pointer, so what follows is the " +
      "highlight arriving (specs/controls.md)",
  );
  const bare = over(AIMED);
  const control = over(CONTROL);

  // The build's own answer for where the node is drawn.
  const at = await nodePoint(h, AIMED);
  assertTrue(at.visible, "the node this point aims at is drawn on the stage");
  await h.pointerMove(at.x, at.y);
  await h.advance(1);
  await h.capture("pick", "The node under the pointer, highlighted");

  assertEqual(
    JSON.stringify((await h.snapshot()).pick.node),
    JSON.stringify(AIMED),
    "the node the build picks under the pointer, which this point reads the " +
      "highlight of (specs/controls.md)",
  );

  assertTrue(
    over(AIMED) !== bare,
    `the drawing over the picked node (${AIMED.x}, ${AIMED.y}, ${AIMED.z}) ` +
      'to change when the pointer takes it: "the picked node under the ' +
      'pointer is highlighted" (specs/overview.md)',
  );
  assertEqual(
    over(CONTROL),
    control,
    `the drawing over the lattice node (${CONTROL.x}, ${CONTROL.y}, ` +
      `${CONTROL.z}), which the pointer never reaches: what is highlighted ` +
      "is the picked node (specs/overview.md)",
  );
});
