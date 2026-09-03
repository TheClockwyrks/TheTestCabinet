// presentation/pending-node-marked — the node a member placement is waiting on is
// marked on the build screen.
//
// specs/controls.md § The build tools: "Strut, cable, rail: the first click picks
// a node and holds it pending, VISIBLY MARKED; the second click on another node
// places the member between them and clears the pending node." specs/ui.md
// § Build says the same from the screen's side: the build screen shows the yard
// "with the picked node highlighted and A PENDING FIRST NODE MARKED". Without the
// mark a player cannot see which node the second click will run the member from.
//
// THE PENDING NODE IS POSED RATHER THAN CLICKED. `setPendingNode(x, y, z)`
// "holds that lattice node as the pending first node of a member placement, as a
// first click does" (specs/instrumentation.md), so this reaches the state the
// requirement is about without going through picking, which is another point's
// business: a build whose picking is broken and whose marking is right must fail
// the picking items and pass this one.
//
// THE POINTER IS PARKED IN A CORNER OF THE STAGE, away from every node, so the
// mark this point reads is the pending node's and not the picked node's.
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
// AND TWO OTHER NODES ARE READ BESIDE IT, so that a build that lit the whole
// lattice when a placement began would fail: what has to change is the drawing
// over the pending node alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LATTICE_PITCH, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  drawnObjects,
  drawnOver,
  drawnSignature,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The node held pending, and two others the mark may not reach. */
const NODE: Vec3 = { x: 4, y: 0, z: 4 };
const AWAY: readonly Vec3[] = [
  { x: 8, y: 0, z: 4 },
  { x: -4, y: 0, z: 4 },
];

/** Where the pointer is parked: a stage corner, away from every node. */
const PARKED = { x: STAGE_W - 10, y: 10 } as const;

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

it("marks the node a placement is holding pending", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(
    before.pendingNode,
    null,
    "the pending node before this point poses one (specs/state.md)",
  );
  const bare = over(NODE);
  const elsewhere = AWAY.map((node) => over(node));

  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  await h.capture("pending", "The node a placement is waiting on");

  const posed = await h.snapshot();
  assertEqual(
    JSON.stringify(posed.pendingNode),
    JSON.stringify(NODE),
    "the node the pose holds pending, which this point is about " +
      "(specs/instrumentation.md)",
  );

  assertTrue(
    over(NODE) !== bare,
    `the drawing over the pending node (${NODE.x}, ${NODE.y}, ${NODE.z}) to ` +
      'change when the placement takes it: the first click "picks a node and ' +
      'holds it pending, visibly marked" (specs/controls.md) and the build ' +
      'screen shows "a pending first node marked" (specs/ui.md)',
  );

  AWAY.forEach((node, index) => {
    assertEqual(
      over(node),
      elsewhere[index]!,
      `the drawing over the ordinary lattice node (${node.x}, ${node.y}, ` +
        `${node.z}), which holding another node pending may not change: what ` +
        "is marked is the pending node (specs/controls.md)",
    );
  });
});
