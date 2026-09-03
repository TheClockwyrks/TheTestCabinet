// presentation/obstacles-drawn — the build screen draws each obstacle as the box
// it occupies.
//
// specs/ui.md § Build: "`build` shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, THE OBSTACLES, the loads at their
// starting poses, the pads, and the structure as built". specs/world.md §
// Obstacles says what an obstacle is: "a fixed axis-aligned box, stated as a
// minimum corner and a size per axis" — so drawing one is drawing that box where
// the box is, which is what the player has to read to know what the crane and the
// load must clear.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws a box AS is its
// own — a solid, a wireframe, a hatched slab, a hazard-striped block. What is
// fixed is that a box standing in the yard is drawn where the box is. So the yard
// is emptied to nothing at all, the yard is read, one obstacle is posed with the
// camera untouched, and the yard is read again.
//
// THE POINTS READ ARE THE BOX'S OWN FACES AND EDGES: the centres of its six
// faces, and the four vertical edges they meet at. A build that drew a marker at
// the box's centre, or a flat patch on the ground under it, reaches none of them.
//
// THE CONTROL POINTS stand twenty units away across the yard, which no drawing of
// a box four units wide can reach, so a build that redrew the whole scene is told
// from one that drew a box.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertEqual,
  assertLessThanOrEqual,
  assertGreaterThan,
} from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The obstacle: a box standing clear of the anchors and well inside the yard. */
const MIN = { x: 4, y: 0, z: 4 } as const;
const SIZE = { x: 4, y: 6, z: 4 } as const;

/**
 * Slack on a point the box is drawn at, in world units.
 *
 * A build draws a solid with an edge of some stroke width and is free to inset a
 * face a little, so the body it puts there need not touch the box's own surface
 * exactly. Half a unit is that slack, and an eighth of the box's smallest side.
 */
const ON_TOLERANCE = 0.5;

/** Slack on a control point, in world units. */
const OFF_TOLERANCE = 2;

/** How many of the ten points on the box's surface must be drawn at. */
const MOST = 9;

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

it("draws a posed obstacle as the box its corner and size give it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const empty = await h.snapshot();
  assertEqual(empty.screen, "build", "the screen opening a site shows");
  assertEqual(
    empty.site.obstacles.length,
    0,
    "the obstacles standing in the emptied yard, before the one this point " +
      "poses",
  );

  const max = {
    x: MIN.x + SIZE.x,
    y: MIN.y + SIZE.y,
    z: MIN.z + SIZE.z,
  };
  const mid = {
    x: MIN.x + SIZE.x / 2,
    y: MIN.y + SIZE.y / 2,
    z: MIN.z + SIZE.z / 2,
  };
  /** The centres of the box's six faces, and its four vertical edges. */
  const onBox = [
    { where: "the top face's centre", x: mid.x, y: max.y, z: mid.z },
    { where: "the bottom face's centre", x: mid.x, y: MIN.y, z: mid.z },
    { where: "the +x face's centre", x: max.x, y: mid.y, z: mid.z },
    { where: "the -x face's centre", x: MIN.x, y: mid.y, z: mid.z },
    { where: "the +z face's centre", x: mid.x, y: mid.y, z: max.z },
    { where: "the -z face's centre", x: mid.x, y: mid.y, z: MIN.z },
    { where: "the +x +z vertical edge", x: max.x, y: mid.y, z: max.z },
    { where: "the +x -z vertical edge", x: max.x, y: mid.y, z: MIN.z },
    { where: "the -x +z vertical edge", x: MIN.x, y: mid.y, z: max.z },
    { where: "the -x -z vertical edge", x: MIN.x, y: mid.y, z: MIN.z },
  ];
  const away = [
    { where: "the ground 20 units away", x: MIN.x - 20, y: 0, z: MIN.z - 20 },
    { where: "the ground across the yard", x: mid.x - 18, y: 0, z: MIN.z - 14 },
  ];

  const before = bodies(h);
  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);
  await h.advance(1);
  const after = bodies(h);
  await h.capture("obstacle", "The yard with one obstacle standing in it");

  assertEqual(
    (await h.snapshot()).site.obstacles.length,
    1,
    "the obstacles standing in the yard once one is posed",
  );

  const changed = changedBodies(before, after);
  const missed = onBox.filter(
    (point) => changedNear(changed, point, ON_TOLERANCE) === 0,
  );
  assertGreaterThan(
    onBox.length - missed.length,
    MOST - 1,
    `the points on the faces and edges of the box (${MIN.x}, ` +
      `${MIN.y}, ${MIN.z}) + (${SIZE.x}, ${SIZE.y}, ${SIZE.z}) that posing ` +
      `the obstacle draws at, out of ${onBox.length}, since the build ` +
      "screen shows the yard's obstacles and an obstacle is the box its " +
      "minimum corner and size give it (specs/ui.md § Build, specs/world.md " +
      `§ Obstacles) — untouched: ${missed.map((p) => p.where).join(", ")}`,
  );

  for (const point of away) {
    assertLessThanOrEqual(
      changedNear(changed, point, OFF_TOLERANCE),
      0,
      `${point.where}, which posing an obstacle over there may not change ` +
        "because an obstacle is drawn as the box it occupies (specs/ui.md " +
        "§ Build)",
    );
  }
});
