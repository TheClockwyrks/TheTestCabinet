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
// picked-node highlight — the other mark the same sentence asks for — is not
// standing at the node under test. It does not move between the two readings, so
// whatever it is doing it is doing in both.
//
// THE READING IS A BEFORE AND AFTER, because what a build marks a pending node
// WITH is its own: a ring, a glow, a coloured cube. What is fixed is that the
// mark is AT that node, so the yard is read where the node stands, and at two
// other lattice nodes of the same yard that the mark may not reach.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The node held pending: a ground lattice node well inside the frame. */
const NODE = { x: 4, y: 0, z: 4 } as const;

/** Two other lattice nodes, four units off, that the mark may not reach. */
const AWAY = [
  { x: 8, y: 0, z: 4 },
  { x: -4, y: 0, z: 4 },
] as const;

/** Where the pointer is parked: the stage's far corner, away from every node. */
const PARKED = { x: STAGE_W - 10, y: 10 } as const;

/**
 * How far from the node a mark on it may stand, in world units.
 *
 * A lattice pitch is `2` (`specs/structure.md`), so a ball of `1` around a node
 * is the node's own half of the yard: a mark drawn on it lies inside, and the
 * next node along lies outside. The two nodes read against this one stand four
 * units away, twice that again.
 */
const ON_TOLERANCE = 1;

/** How near another node the mark may not come, in world units. */
const OFF_TOLERANCE = 1;

/* -------------------------------------------------------------------------- */
/* Reading the yard                                                           */
/* -------------------------------------------------------------------------- */
//
// THIS ENGINE'S HALF OF THIS POINT IS WHERE THE PICTURE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so the yard has no pixels at all. An engineless
// build owns its own renderer, so its version of this point photographs the page
// and reads colours at projected stage points; here the same question is asked in
// WORLD units, of the bodies the build put in the scene. That is the stronger
// reading of the two: a body drawn in the right part of the picture but in the
// wrong place in the world passes there and fails here.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.

/** One body the yard is drawn from, and where it stands in the world. */
interface Body {
  /** Everything about it a redraw would have to keep to be the same body. */
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard is drawn from, with its world extent.
 *
 * A body is anything the build put in the scene that occupies space — a mesh, a
 * line, a cloud of points. Lights and bare groups occupy none and are skipped:
 * they carry no extent for a reading about a place to be about.
 */
function bodies(harness: Harness): Body[] {
  const found: Body[] = [];
  harness.engine.scene.traverse((object) => {
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    found.push({
      signature: [
        object.type,
        object.visible ? "1" : "0",
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
        material?.color?.getHexString() ?? "",
        material?.emissive?.getHexString() ?? "",
        material?.opacity ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Every body one reading holds that the other does not, either way round. */
function changedBodies(
  before: readonly Body[],
  after: readonly Body[],
): Body[] {
  const tally = (read: readonly Body[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const body of read) {
      counts.set(body.signature, (counts.get(body.signature) ?? 0) + 1);
    }
    return counts;
  };
  const was = tally(before);
  const now = tally(after);
  return [
    ...after.filter(
      (body) => (now.get(body.signature) ?? 0) > (was.get(body.signature) ?? 0),
    ),
    ...before.filter(
      (body) => (now.get(body.signature) ?? 0) < (was.get(body.signature) ?? 0),
    ),
  ];
}

/** How many of `changed` reach within `radius` world units of `at`. */
function changedNear(
  changed: readonly Body[],
  at: { x: number; y: number; z: number },
  radius: number,
): number {
  const ball = new THREE.Sphere(new THREE.Vector3(at.x, at.y, at.z), radius);
  return changed.filter((body) => body.box.intersectsSphere(ball)).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("marks the node a placement is holding pending", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);

  const before = await h.snapshot();
  assertEqual(before.screen, "build", "the screen opening a site shows");
  assertEqual(
    before.pendingNode,
    null,
    "the pending node an opened site leaves, before this point poses one " +
      "(specs/state.md)",
  );

  const unmarked = bodies(h);
  await h.debug.setPendingNode(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  const marked = bodies(h);
  await h.capture("pending", "The node held pending");

  const held = (await h.snapshot()).pendingNode;
  assertEqual(
    held === null ? null : `${held.x}, ${held.y}, ${held.z}`,
    `${NODE.x}, ${NODE.y}, ${NODE.z}`,
    "the node the game is holding pending once one is posed, which this " +
      "point's reading is about (specs/instrumentation.md)",
  );

  const changed = changedBodies(unmarked, marked);
  assertGreaterThan(
    changedNear(changed, NODE, ON_TOLERANCE),
    0,
    `the yard within ${ON_TOLERANCE} world units of the node ` +
      `(${NODE.x}, ${NODE.y}, ${NODE.z}) to change when that node is held ` +
      "pending, since the first click of a member placement holds a node " +
      "pending and marks it visibly (specs/controls.md § The build tools, " +
      "specs/ui.md § Build)",
  );

  for (const node of AWAY) {
    assertLessThanOrEqual(
      changedNear(changed, node, OFF_TOLERANCE),
      0,
      `the yard around the node (${node.x}, ${node.y}, ${node.z}), which ` +
        "holding another node pending may not change: the mark stands at the " +
        "node the second click will run the member from (specs/controls.md " +
        "§ The build tools)",
    );
  }
});
