// presentation/picked-node-highlighted — the node a click would take is
// highlighted before the click.
//
// specs/overview.md, "Visual design": "On the build screen, the buildable lattice
// and the envelope's extent are visible aids, and the picked node under the
// pointer is highlighted." specs/controls.md says the same from the other side:
// a node pick "considers every lattice node in the envelope that stands in front
// of the camera, projected to the stage; the candidate is the nearest at most
// `NODE_PICK_PX` (`20`) logical pixels from the click... The candidate under the
// pointer is highlighted before the click, so the player sees what a click would
// take."
//
// SO THE HIGHLIGHT IS A DIFFERENCE THE POINTER MAKES. What the build draws it AS
// is entirely its own — a ring, a brighter mark, a cage — so the reading is the
// same yard with the pointer on a node and with the pointer away from every
// node: what parted between those two is the highlight, and it has to stand at
// the node the snapshot reports as `pick.node`.
//
// THE NODE READ IS THE ONE THE BUILD ITSELF PICKED. The pointer is put on a
// chosen node's projected point, and then `pick.node` says which node a click
// would take there. A validator that insisted on its own answer to the pick would
// be grading `specs/controls.md`'s tie-breaking, which is another point's.
//
// THE CONTROL IS A SECOND LATTICE NODE far from the pointer in both readings. It
// says the highlight is one node's and not a change over the whole lattice: a
// build that lit every node when the pointer entered the yard would answer the
// first half and fail here.
//
// THE YARD IS EMPTIED — nothing built, no loads, no obstacles — so the only thing
// that can change under the pointer is the aid this point is about.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertNotNull,
  assertNull,
  assertTrue,
} from "../assert";
import { NODE_PICK_PX, STAGE_H, STAGE_W } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/** The node the pointer is put on: on the ground, off the anchors, in the clear. */
const AIMED: Vec3 = { x: 6, y: 0, z: -4 };

/** The node that must not change: another ground node, far from the pointer. */
const CONTROL: Vec3 = { x: -4, y: 0, z: 4 };

/** Where the pointer goes when it is off every node: a stage corner. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

/**
 * How far from a node a highlight on it may stand, in world units.
 *
 * A lattice pitch is `2` (`specs/structure.md`), so a ball of `1` around a node
 * is that node's own half of the yard: a mark drawn on it lies inside, and the
 * next node along lies outside.
 */
const REACH = 1;

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

it("highlights the node under the pointer and leaves the rest of the lattice alone", async () => {
  await openSite(h, SITE);
  await clearAll(h);

  const aimed = await h.project(AIMED.x, AIMED.y, AIMED.z);
  const control = await h.project(CONTROL.x, CONTROL.y, CONTROL.z);
  assertTrue(
    aimed.visible && control.visible,
    `the nodes (${AIMED.x}, ${AIMED.y}, ${AIMED.z}) and (${CONTROL.x}, ` +
      `${CONTROL.y}, ${CONTROL.z}) to be drawn on the stage at the start ` +
      "camera pose (specs/instrumentation.md)",
  );
  assertGreaterThan(
    Math.hypot(control.x - aimed.x, control.y - aimed.y),
    2 * NODE_PICK_PX,
    "the control node to stand further than the pick radius from the aimed " +
      "one, so the pointer is never picking it (specs/controls.md)",
  );

  await h.pointerMove(aimed.x, aimed.y);
  await h.advance(1);
  const over = await h.snapshot();
  assertNotNull(
    over.pick.node,
    `a node picked with the pointer on (${AIMED.x}, ${AIMED.y}, ${AIMED.z})'s ` +
      `projected point, which is within NODE_PICK_PX (${NODE_PICK_PX}) of it ` +
      "(specs/controls.md)",
  );
  const picked = over.pick.node as Vec3;
  const onNode = bodies(h);
  await h.capture("pick", "The picked node highlighted under the pointer");

  await h.pointerMove(PARKED.x, PARKED.y);
  await h.advance(1);
  const away = await h.snapshot();
  assertNull(
    away.pick.node,
    "no node picked with the pointer parked in a stage corner, which is what " +
      "makes the second reading the same yard with nothing highlighted " +
      "(specs/controls.md)",
  );
  const offNode = bodies(h);

  const changed = changedBodies(onNode, offNode);
  assertGreaterThan(
    changedNear(changed, picked, REACH),
    0,
    `the yard within ${REACH} world unit of (${picked.x}, ${picked.y}, ` +
      `${picked.z}) — the node the snapshot reports a click would take — to ` +
      "change when the pointer leaves it, since the picked node under the " +
      "pointer is highlighted (specs/overview.md)",
  );
  assertLessThanOrEqual(
    changedNear(changed, CONTROL, REACH),
    0,
    `the yard around the lattice node (${CONTROL.x}, ${CONTROL.y}, ` +
      `${CONTROL.z}), which no pointer was ever near, to stand unchanged: it ` +
      "is the PICKED node that is highlighted (specs/overview.md)",
  );
});
