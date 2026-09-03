// presentation/lattice-aids-visible — the build screen draws the buildable
// lattice as a visible aid.
//
// specs/overview.md, "Visual design", the row for the lattice: "On the build
// screen, the buildable lattice and the envelope's extent are visible aids, and
// the picked node under the pointer is highlighted." specs/ui.md, "Build":
// `build` "shows the yard through the camera: the ground, the lattice and
// envelope aids, the anchors, the obstacles, the loads at their starting poses,
// the pads, and the structure as built". The lattice itself is
// specs/world.md's: "the points whose coordinates are all integer multiples of
// `LATTICE_PITCH` (`2`)", bounded by the site's envelope.
//
// WHAT AN AID BEING VISIBLE MEANS HERE. The player has to read where a member
// may start and end before clicking, so the picture has to carry something at a
// lattice node that it does not carry between nodes. That is the reading: a node
// against the middle of a cell beside it — a position with no lattice node on it
// and nothing else in the yard, which is where a build that drew no lattice
// would look exactly the same as at the node.
//
// THE CELL MIDDLE IS TAKEN ONE STEP ALONG `+x` AND ONE BACK ALONG `-z`, which is
// the middle of the cell next door: a ground position whose coordinates are both
// odd, so no lattice node stands on it and nothing that follows the lattice
// passes through it.
//
// THE NODE IS READ AS A NEIGHBOURHOOD rather than as a mathematical point. How
// big a build draws its lattice marks is its own, so a mark is looked for within
// `REACH` of the node — a radius far smaller than the lattice pitch of `2`, so a
// mark found there belongs to this node, and smaller again than the `1.41` units
// to the cell middle it is read against.
//
// THE YARD IS EMPTIED and the pointer is parked off every node: nothing is built,
// no loads, no obstacles, and no node is picked, so the only thing that can be
// standing at a lattice node is the aid. The nodes are all on the ground, well
// inside the envelope, clear of the site's anchors and clear of the readouts.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThanOrEqual, assertNull, assertTrue } from "../assert";
import { STAGE_H, STAGE_W } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  runTicks,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/**
 * Six ground lattice nodes: inside site 1's envelope (`x -8..12`, `z -8..12`),
 * off its four anchors at `(0..2, 0, 0..2)`, off its envelope's own boundary,
 * and drawn clear of the readouts down the left of the build screen.
 */
const NODES: readonly Vec3[] = [
  { x: 4, y: 0, z: -4 },
  { x: 6, y: 0, z: -4 },
  { x: 8, y: 0, z: -2 },
  { x: 4, y: 0, z: 4 },
  { x: 6, y: 0, z: 6 },
  { x: 8, y: 0, z: 4 },
];

/** How many of the six must carry a mark for the aid to be visible. */
const NEEDED = 5;

/** How far around a node its mark is looked for, in world units. */
const REACH = 0.4;

/** Where the pointer is parked: a stage corner, so no node is picked. */
const PARKED = { x: STAGE_W - 4, y: STAGE_H - 4 } as const;

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
// WORLD units, of the bodies the build put in the scene.
//
// NOTHING IS FOUND BY NAME. What a build calls the objects it renders is its own;
// where it puts them is not.
//
// A BODY IS READ AT ITS OWN RESOLUTION, not at its bounding box's. A box is right
// for a solid, but an outline drawn as line segments and a cloud of points both
// have bounding boxes covering everything they enclose, and this point turns on
// whether something is drawn AT a place rather than around it. So a line is
// tested segment by segment and a cloud vertex by vertex.
//
// AND A BODY THAT SPANS THE YARD MARKS NO PLACE IN IT. The ground plane and the
// sky enclose every position there is, so a reading that counted them would
// answer "yes" everywhere and decide nothing. A solid is only counted when it is
// small enough to be about one place: at most `LOCAL` world units across, which
// is longer than the longest member a site allows and a small fraction of the
// hundreds of units a ground plane or a sky dome spans.

/** A solid reaching further than this across spans the yard, not one place. */
const LOCAL = 20;

/** Whether the yard shows anything within `radius` world units of `at`. */
function drawnAt(
  harness: Harness,
  at: { x: number; y: number; z: number },
  radius: number,
): boolean {
  const point = new THREE.Vector3(at.x, at.y, at.z);
  const first = new THREE.Vector3();
  const second = new THREE.Vector3();
  const segment = new THREE.Line3();
  const nearest = new THREE.Vector3();
  let found = false;

  harness.engine.scene.traverse((object) => {
    if (found) return;
    const drawn = object as unknown as {
      isMesh?: boolean;
      isLine?: boolean;
      isLineSegments?: boolean;
      isPoints?: boolean;
    };
    if (
      drawn.isMesh !== true &&
      drawn.isLine !== true &&
      drawn.isPoints !== true
    ) {
      return;
    }
    // Hidden bodies fill nothing: a build is free to keep a pool and hide what
    // it is not using, and the engine's scene retains both.
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
    }
    object.updateWorldMatrix(true, false);

    if (drawn.isMesh === true) {
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) > LOCAL) return;
      box.expandByScalar(radius);
      if (box.containsPoint(point)) found = true;
      return;
    }

    const geometry = (object as THREE.Points).geometry;
    const positions = geometry.getAttribute("position") as
      | THREE.BufferAttribute
      | undefined;
    if (positions === undefined) return;

    if (drawn.isPoints === true) {
      for (let index = 0; index < positions.count; index += 1) {
        first
          .fromBufferAttribute(positions, index)
          .applyMatrix4(object.matrixWorld);
        if (first.distanceTo(point) <= radius) {
          found = true;
          return;
        }
      }
      return;
    }

    // A line: `LineSegments` is disjoint pairs, a plain `Line` a polyline.
    const step = drawn.isLineSegments === true ? 2 : 1;
    for (let index = 0; index + 1 < positions.count; index += step) {
      first
        .fromBufferAttribute(positions, index)
        .applyMatrix4(object.matrixWorld);
      second
        .fromBufferAttribute(positions, index + 1)
        .applyMatrix4(object.matrixWorld);
      segment.set(first, second);
      segment.closestPointToPoint(point, true, nearest);
      if (nearest.distanceTo(point) <= radius) {
        found = true;
        return;
      }
    }
  });

  return found;
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
  // The YARD AND THE STRUCTURE, rather than the whole world: a site opens with an
  // empty tape (`specs/state.md`) and nothing here poses one, so the tape needs no
  // clearing and the program screen is never visited.
  await emptyYard(h);
  await h.debug.clearStructure();
  await h.pointerMove(PARKED.x, PARKED.y);
  // The frame and the reading in one crossing: `runTicks` answers with the state
  // the ticks it drove left (`validation/harness.ts`).
  const posed = await runTicks(h, 1);
  assertTrue(
    posed.screen === "build",
    "the build screen, which is where the lattice is an aid (specs/ui.md)",
  );
  assertNull(
    posed.pick.node,
    "no node picked under the parked pointer, so nothing here is the picked " +
      "node's highlight rather than the lattice aid (specs/controls.md)",
  );

  await h.capture("lattice", "The lattice aid on the empty build screen");

  const missing: string[] = [];
  for (const node of NODES) {
    const cell = { x: node.x + 1, y: node.y, z: node.z - 1 };
    assertTrue(
      !drawnAt(h, cell, REACH),
      `the middle of the cell beside (${node.x}, ${node.y}, ${node.z}), at ` +
        `(${cell.x}, ${cell.y}, ${cell.z}), to carry nothing: it is on no ` +
        "lattice node and the yard is emptied, so it is what a node's own " +
        "mark is read against (specs/world.md)",
    );
    if (!drawnAt(h, node, REACH)) {
      missing.push(`(${node.x}, ${node.y}, ${node.z})`);
    }
  }

  assertGreaterThanOrEqual(
    NODES.length - missing.length,
    NEEDED,
    `${NEEDED} of the ${NODES.length} lattice nodes read to carry a mark the ` +
      "middle of the cell beside them does not, since the build screen draws " +
      "the buildable lattice as a visible aid (specs/overview.md); nothing " +
      `stood at ${missing.join(", ")}`,
  );
});
