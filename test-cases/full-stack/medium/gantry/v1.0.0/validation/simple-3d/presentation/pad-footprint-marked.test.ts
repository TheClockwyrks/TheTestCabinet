// presentation/pad-footprint-marked — a load's pad is drawn as a footprint at
// the target position.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground or on an obstacle's top, showing the class outline at
// the target yaw." specs/overview.md § Visual design puts the same requirement on
// the yard's legibility: "Anchor points, each load's starting position, and each
// pad's footprint and required yaw are marked so a site is readable before
// anything is built."
//
// THE SCENARIO MOVES THE PAD RATHER THAN REMOVING THE LOAD. What a build draws a
// pad AS is entirely its own — an outline, a hatched patch, a decal — so the
// reading has to be a before and after. Taking the load away would take its body
// off the screen at the same time, and then a change at the target could be the
// load's own drawing rather than the pad's. `setLoadTarget` moves ONLY the pad
// (specs/instrumentation.md: "Sets the target pose of the load at `index`, which
// is the pad it must be set down on"), so the load stands exactly where it stood,
// the camera is untouched, and the one thing that differs between the two
// pictures is where the pad is.
//
// WHERE THE FOOTPRINT IS IS FIXED IN WORLD UNITS. The corners and edge midpoints
// of the crate's 2 x 2 footprint stand under the target position on the ground,
// and that is where the yard is read.
//
// THE TOLERANCES. A point is read as a small ball rather than as a mathematical
// point: an outline is a stroke of the build's own width and may be inset or
// swelled a little, so a third of a unit of slack is honest for "the footprint
// reaches here". The control points sit four units — a whole footprint's width —
// outside it, read with twice that slack, which is far more room than any stroke
// and still nowhere near the load itself.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertLessThanOrEqual } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The site this runs on: its yard is emptied to nothing but the one load. */
const SITE = 0;

/** The load whose pad this point is about, and where it stands. */
const CLASS = "crate";
const MASS = 40;
const START = { x: 10, y: 2, z: 0, yaw: 0 } as const;

/** The pad the load is wanted on, and where the pad is moved to afterwards. */
const TARGET = { x: 0, y: 2, z: 10, yaw: 0 } as const;
const ELSEWHERE = { x: -8, y: 2, z: -6, yaw: 0 } as const;

/** Slack on a point the footprint is drawn at, in world units. */
const ON_TOLERANCE = 0.35;
/** Slack on a point it may not reach, in world units. */
const OFF_TOLERANCE = 0.7;

/** How far outside the footprint the control points stand, in world units. */
const CLEAR = 4;

/**
 * How many of the eight outline points a footprint has to be drawn at.
 *
 * Not all eight: the footprint is "the class outline at the target yaw" and a
 * build is free to draw that outline dashed, or to break it at the midpoints of
 * its sides for the yaw marker the same sentence asks for, so two of the eight
 * points are given away. Six of eight still cannot be reached by anything but a
 * mark that follows the footprint's own square.
 */
const MOST = 6;

/** A picture of the page, RGBA, four bytes per pixel, row-major. */
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

it("marks the load's footprint on the ground at its target position", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);
  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, TARGET.yaw);
  await h.advance(1);
  await h.capture("pad", "The pad marked on the ground");

  // The footprint: the class's 2 x 2 box at yaw 0, on the ground under the
  // target position (specs/world.md — "Every load pose in this specification is
  // the pose of the load's lift point", and the box "extends half its width and
  // half its depth horizontally from the lift point"). Its four corners and the
  // midpoints of its four sides.
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const outline: { where: string; x: number; z: number }[] = [];
  for (const dx of [-1, 0, 1]) {
    for (const dz of [-1, 0, 1]) {
      if (dx === 0 && dz === 0) continue;
      outline.push({
        where: `(${dx}, ${dz}) of the footprint`,
        x: TARGET.x + (dx * size.x) / 2,
        z: TARGET.z + (dz * size.z) / 2,
      });
    }
  }
  const clear = [
    { where: `${CLEAR} units short of it`, x: TARGET.x, z: TARGET.z - CLEAR },
    { where: `${CLEAR} units past it`, x: TARGET.x, z: TARGET.z + CLEAR },
    { where: `${CLEAR} units to one side`, x: TARGET.x + CLEAR, z: TARGET.z },
    { where: `${CLEAR} units to the other`, x: TARGET.x - CLEAR, z: TARGET.z },
  ];

  const before = bodies(h);
  // The pad, and only the pad, moves: the load stands where it stood.
  await h.debug.setLoadTarget(
    0,
    ELSEWHERE.x,
    ELSEWHERE.y,
    ELSEWHERE.z,
    ELSEWHERE.yaw,
  );
  await h.advance(1);
  const after = bodies(h);
  const changed = changedBodies(before, after);

  const missing = outline.filter(
    (point) =>
      changedNear(changed, { x: point.x, y: 0, z: point.z }, ON_TOLERANCE) ===
      0,
  );
  assertGreaterThan(
    outline.length - missing.length,
    MOST - 1,
    "the points of the crate's footprint on the ground under " +
      `(${TARGET.x}, ${TARGET.y}, ${TARGET.z}) that the pad is drawn at, out ` +
      `of ${outline.length}, since a load's target pose is drawn as a marked ` +
      "footprint there (specs/world.md § Pads) — unmarked: " +
      `${missing.map((point) => point.where).join(", ")}`,
  );

  for (const point of clear) {
    assertLessThanOrEqual(
      changedNear(changed, { x: point.x, y: 0, z: point.z }, OFF_TOLERANCE),
      0,
      `the ground ${point.where}, which moving the pad may not change ` +
        "because a pad is a footprint at the target position rather than a " +
        "mark spread over the yard (specs/world.md § Pads)",
    );
  }
});
