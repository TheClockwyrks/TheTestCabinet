// presentation/orbiting-redraws-the-scene — turning the camera redraws the yard
// from the new pose.
//
// specs/overview.md, "Hard requirements": "Render a real 3D scene on the canvas:
// the yard, the lattice aids, the crane's members and parts, the loads, and the
// readouts, with a camera the player orbits." specs/controls.md, "The camera":
// the build, program, and run screens "show the 3D yard through an orbit camera",
// and `setCamera` poses that camera's yaw, pitch, and distance.
//
// WHAT THAT MEANS FOR THE PICTURE, and it is the whole of what this point
// decides: a thing standing at a world position is drawn where the camera puts
// it, so moving the camera moves the drawing. A build that painted a fixed
// picture of a yard — a backdrop, a pre-rendered still — would answer the same
// pixels from every pose and fail here, which is exactly the failure the
// requirement is written against.
//
// THIS ENGINE'S HALF OF THE POINT, AND IT IS TWO READINGS RATHER THAN ONE. Under
// this engine the yard is rendered by the engine, through the camera the build's
// own `render` poses, and this process has no GPU: there are no pixels to compare
// two poses of. What there is instead is exactly the two halves the requirement
// rests on, and each is read where it lives.
//
//   - THE CAMERA MOVES WITH THE POSE. `h.project` answers "the point on the stage
//     the world position is drawn at, through the camera as it stands"
//     (`specs/instrumentation.md`), and here it answers through the camera the
//     build's `render` just posed. So turning the orbit a quarter turn has to
//     carry the member's middle a long way across the stage. A build that posed
//     no camera, or posed one that ignores the orbit, answers the same point from
//     both poses and fails here — which is the backdrop failure the requirement
//     is written against.
//
//   - THE YARD IS REAL GEOMETRY IN THE WORLD. `specs/overview.md` asks a build to
//     "render a real 3D scene on the canvas", and a pre-rendered still is not one.
//     So the member's middle carries a body while the member stands and carries
//     none once it is taken away — read in world units, where a backdrop has
//     nothing at all.
//
// THE MEMBER STANDS ALONE IN AN EMPTIED YARD — no other structure, no loads, no
// obstacles — and is a horizontal strut far out along `+x`, which is where the
// two poses this point uses carry it furthest apart on the stage and clear of
// the readouts on either side.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertGreaterThan,
  assertLessThanOrEqual,
  assertTrue,
} from "../assert";
import {
  CAMERA_START_DIST,
  CAMERA_START_PITCH,
  CAMERA_START_YAW,
  STAGE_H,
  STAGE_W,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The member: a horizontal strut, well out along `+x`, inside every envelope. */
const FROM = { x: 8, y: 6, z: 0 } as const;
const TO = { x: 12, y: 6, z: 0 } as const;
const MIDDLE = { x: 10, y: 6, z: 0 } as const;

/**
 * A point ON the member that is on no lattice node: `x` is odd, and
 * `LATTICE_PITCH` is `2`, so every node's coordinates are even
 * (specs/world.md). It is where the member's own body is looked for, so the
 * lattice aid standing at the nodes either side of it answers for nothing.
 */
const ON_MEMBER = { x: 9, y: 6, z: 0 } as const;

/** The second camera pose: a quarter turn around the yard, nothing else moved. */
const TURNED_YAW = CAMERA_START_YAW + 90;

/**
 * How far the two projected middles must lie apart, in logical pixels.
 *
 * Not a figure the specification states — it is this scenario's own headroom.
 * The two points have to be far enough apart that a member drawn at one is
 * plainly not covering the other: the member is at most a few tens of pixels
 * wide on screen, so a hundred pixels is several times its own drawn width.
 */
const SEPARATION = 100;

/**
 * How far around that point the member's body is looked for, in world units.
 *
 * Far short of the one unit to the nearest lattice node either side of it, so
 * the lattice aid is never what answers.
 */
const REACH = 0.4;

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
        first.fromBufferAttribute(positions, index).applyMatrix4(
          object.matrixWorld,
        );
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
      first.fromBufferAttribute(positions, index).applyMatrix4(
        object.matrixWorld,
      );
      second.fromBufferAttribute(positions, index + 1).applyMatrix4(
        object.matrixWorld,
      );
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

it("draws the member at its new projected point and no longer at the old one", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setCamera(
    CAMERA_START_YAW,
    CAMERA_START_PITCH,
    CAMERA_START_DIST,
  );
  await h.debug.addMember(FROM.x, FROM.y, FROM.z, TO.x, TO.y, TO.z, "strut");
  await h.advance(1);

  const posed = await h.snapshot();
  assertTrue(
    posed.structure.members.length === 1,
    "the one member this point poses to stand in the emptied yard " +
      "(specs/structure.md)",
  );

  const before = await h.project(MIDDLE.x, MIDDLE.y, MIDDLE.z);
  assertTrue(
    before.visible,
    `the member's middle (${MIDDLE.x}, ${MIDDLE.y}, ${MIDDLE.z}) to be drawn ` +
      `on the stage at yaw ${CAMERA_START_YAW}, which this point needs a ` +
      "picture of (specs/instrumentation.md)",
  );

  await h.debug.setCamera(TURNED_YAW, CAMERA_START_PITCH, CAMERA_START_DIST);
  await h.advance(1);

  const after = await h.project(MIDDLE.x, MIDDLE.y, MIDDLE.z);
  assertTrue(
    after.visible,
    `the member's middle to be drawn on the stage at yaw ${TURNED_YAW} too, ` +
      "so this point can read where the turn carried it " +
      "(specs/instrumentation.md)",
  );
  assertGreaterThan(
    Math.hypot(after.x - before.x, after.y - before.y),
    SEPARATION,
    `the two projected middles, ${SEPARATION} logical pixels apart, which is ` +
      `what turning the camera from yaw ${CAMERA_START_YAW} to ` +
      `${TURNED_YAW} moves a position this far out in the yard ` +
      "(specs/controls.md)",
  );
  assertTrue(
    after.x >= 0 && after.x < STAGE_W && after.y >= 0 && after.y < STAGE_H,
    "the turned camera's projected middle to lie on the stage",
  );

  const standing = drawnAt(h, ON_MEMBER, REACH);
  await h.capture("orbited", "The same crane from two camera poses");

  await h.debug.removeMember(0);
  await h.advance(1);
  const gone = drawnAt(h, ON_MEMBER, REACH);

  assertTrue(
    standing,
    `the member to be drawn as a body at (${ON_MEMBER.x}, ${ON_MEMBER.y}, ` +
      `${ON_MEMBER.z}), a point along it, since the yard is a real 3D scene ` +
      "rather than a picture of one (specs/overview.md § Hard requirements)",
  );
  assertLessThanOrEqual(
    gone ? 1 : 0,
    0,
    `(${ON_MEMBER.x}, ${ON_MEMBER.y}, ${ON_MEMBER.z}) to carry nothing once ` +
      "the member is taken away, which is what says the body read there was " +
      "the member and not a backdrop the camera turns over " +
      "(specs/overview.md § Hard requirements)",
  );
});
