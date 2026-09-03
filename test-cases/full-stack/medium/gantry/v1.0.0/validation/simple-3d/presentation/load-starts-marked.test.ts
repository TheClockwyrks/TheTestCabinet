// presentation/load-starts-marked — each load is drawn where the site starts it.
//
// specs/overview.md, "Visual design", the row for anchors and pads: "Anchor
// points, each load's starting position, and each pad's footprint and required
// yaw are marked so a site is readable before anything is built."
// specs/ui.md, "Build": `build` "shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, the obstacles, the loads at their
// starting poses, the pads, and the structure as built". specs/world.md fixes
// what a load occupies: "Every load pose in this specification is the pose of the
// load's lift point: the center of its top face... The load's box extends half
// its width and half its depth horizontally from the lift point, rotated by its
// yaw, and its full height below it", with `crate` `2 x 2 x 2`.
//
// SO THE READING IS WHERE THE BOX IS, and this engine reads it in world units.
// The class box at the authored starting pose is a box of the specification's
// own; what the point asks is that adding the load puts a body inside it, and
// puts none in the box the same load would occupy somewhere else.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws a crate as is
// its own produced model (specs/assets.md). The yard is emptied to nothing, the
// yard is read, one load is posed with the camera and the pointer untouched, and
// the yard is read again.
//
// THE CONTROL IS THE SAME BOX SOMEWHERE ELSE IN THE YARD — the extent the load
// would occupy eight units along `+z` of where it was actually put. It is what
// says the load is drawn at ITS starting pose rather than wherever the build
// felt like putting a crate. The load's pad is authored far from both extents,
// so neither reading is the pad's marking.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

const SITE = 0;

/** The one load: a crate, at rest on the ground, out in the clear. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 8, y: 2, z: -4, yaw: 0 };

/** Where it is wanted: far from the extent this point reads, so is its pad. */
const TARGET: LoadPose = { x: -6, y: 2, z: 6, yaw: 0 };

/** The extent that must stand unchanged: the same box, eight units along `+z`. */
const ELSEWHERE: LoadPose = { x: 8, y: 2, z: 4, yaw: 0 };

/** The grid of points read through the middle of a box's own extent. */
const GRID: number = 3;

/** How much of the box the grid spans, either way from its middle. */
const INSET = 0.3;

/**
 * How many of those points the drawn load must reach: a majority.
 *
 * Not every one of them. A build models its own crate (specs/assets.md) and is
 * free to bevel it, hollow it, or leave its corners open, so a point inside the
 * class box need not have anything drawn through it. What no build can do is fill
 * a majority of the box's middle while drawing the load somewhere else — and the
 * extent this check reads elsewhere in the yard has to be reached at NO point at
 * all, which is the other side of the same claim.
 */
const NEEDED = 14;

/** How near a point a body must come to be drawn there, in world units. */
const REACH = 0.2;

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
    const material = (object as THREE.Mesh).material as
      | Partial<THREE.MeshStandardMaterial>
      | undefined;
    found.push({
      signature: [
        object.type,
        object.visible ? "1" : "0",
        box.min
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
        box.max
          .toArray()
          .map((one) => one.toFixed(3))
          .join(),
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

/**
 * A grid of points through the middle of the box a load occupies at `pose`.
 *
 * `specs/world.md`: a load pose is "the pose of the load's lift point: the center
 * of its top face", and its box "extends half its width and half its depth
 * horizontally from the lift point, rotated by its yaw, and its full height below
 * it". The yaw here is `0` in both poses, so the box is axis-aligned.
 */
function inside(pose: LoadPose): { x: number; y: number; z: number }[] {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const points: { x: number; y: number; z: number }[] = [];
  for (let ix = 0; ix < GRID; ix += 1) {
    for (let iy = 0; iy < GRID; iy += 1) {
      for (let iz = 0; iz < GRID; iz += 1) {
        const t = (index: number): number =>
          GRID === 1 ? 0.5 : INSET + ((1 - 2 * INSET) * index) / (GRID - 1);
        points.push({
          x: pose.x + (t(ix) - 0.5) * size.x,
          y: pose.y - t(iy) * size.y,
          z: pose.z + (t(iz) - 0.5) * size.z,
        });
      }
    }
  }
  return points;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a waiting load at the starting pose the site gives it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  assertLessThanOrEqual(
    (await h.snapshot()).site.loads.length,
    0,
    "the loads standing in the emptied yard, before the one this point poses",
  );

  const empty = bodies(h);

  await addOneLoad(h, CLASS, MASS, START, TARGET);
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.site.loads.length === 1,
    "the one load this point poses to stand in the yard (specs/world.md)",
  );
  const authored = posed.site.loads[0]!;
  assertTrue(
    authored.from.x === START.x &&
      authored.from.y === START.y &&
      authored.from.z === START.z,
    `the load's authored starting pose to be (${START.x}, ${START.y}, ` +
      `${START.z}), which is what this point reads the yard against`,
  );

  const laden = bodies(h);
  await h.capture("loads", "A waiting load drawn at its starting pose");

  const changed = changedBodies(empty, laden);
  const started = inside(START);
  const painted = started.filter(
    (point) => changedNear(changed, point, REACH) > 0,
  ).length;
  assertGreaterThanOrEqual(
    painted,
    NEEDED,
    `${NEEDED} of the ${started.length} points read through the extent the ` +
      `load's box occupies at (${START.x}, ${START.y}, ${START.z}) to be ` +
      "drawn at when the load is posed, since the build screen shows the " +
      "loads at their starting poses (specs/ui.md)",
  );

  const spilled = inside(ELSEWHERE).filter(
    (point) => changedNear(changed, point, REACH) > 0,
  ).length;
  assertLessThanOrEqual(
    spilled,
    0,
    `the extent the same box would occupy at (${ELSEWHERE.x}, ` +
      `${ELSEWHERE.y}, ${ELSEWHERE.z}) to stand unchanged, since a waiting ` +
      "load is drawn at its own starting pose (specs/ui.md); it changed at " +
      `${spilled} of the ${started.length} points read there`,
  );
});
