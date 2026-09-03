// presentation/pad-on-an-obstacle-top — a pad whose target sits on an obstacle
// is drawn on that obstacle's top face.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground OR ON AN OBSTACLE'S TOP, showing the class outline at
// the target yaw." specs/world.md § Obstacles says why such a target exists: "An
// obstacle's top face is therefore solid ground for a load: a pad may sit on top
// of an obstacle, and a load set down on that pad rests on the face without
// reaching inside the box, which is how a site asks for a lift onto a platform."
//
// THE SCENARIO IS SITE FIVE'S OWN LIFT. `High Shelf` carries one obstacle, the
// platform whose minimum corner is `(-9, 0, -2)` and whose size is `(4, 6, 4)`,
// and asks for its container on `(-7, 8, 0)` at yaw `90` (specs/sites.md). A
// container is `4 x 2 x 2` and a target pose is the pose of the lift point, the
// centre of the load's top face (specs/world.md), so a container resting on that
// pad stands on the platform's top face at `y = 6` — which is where its footprint
// belongs, six units above the ground the platform stands on. The yard is emptied
// of everything but that one load and the platform it is wanted on, and nothing
// is built.
//
// THE PAD IS MOVED RATHER THAN THE LOAD REMOVED, so the one thing that differs
// between the two pictures is where the pad is: `setLoadTarget` "sets the target
// pose of the load at `index`, which is the pad it must be set down on"
// (specs/instrumentation.md) and touches nothing else, so the load's own body,
// the platform, and the camera all stand exactly as they stood.
//
// THIS ENGINE READS THE YARD IN WORLD UNITS, which is where the requirement is
// stated: the footprint's corners are world points on the platform's top face,
// and what the reading asks is that moving the pad changes what is drawn there.
//
// WHAT THE READING CAN AND CANNOT DECIDE. It decides that the footprint is drawn
// on the platform's top face, at the four corners of the container's footprint
// turned to the target yaw — `(-7 ± 1, 6, 0 ± 2)` — and that the rest of that
// top face is left alone. It cannot decide that the pad is NOT also drawn on the
// ground under the platform, because the platform stands on that ground and hides
// it from every camera pose; that half of the requirement is unobservable and is
// left unasserted rather than asserted against the reference's own choice.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import {
  assertEqual,
  assertGreaterThan,
  assertLessThanOrEqual,
} from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import { addOneLoad, createHarness, openSite, type Harness } from "../harness";

/** High Shelf: the site whose container is wanted on top of its platform. */
const SITE = 4;

/** That lift, as specs/sites.md authors it. */
const CLASS = "container";
const MASS = 80;
const START = { x: 8, y: 2, z: 0, yaw: 0 } as const;
const TARGET = { x: -7, y: 8, z: 0, yaw: 90 } as const;

/** The platform's top face, from the site's own obstacle box. */
const TOP_Y = 6;

/** Where the pad is sent so the second picture has none on the platform. */
const ELSEWHERE = { x: 6, y: 2, z: 6, yaw: 90 } as const;

/** Slack on a point the outline is drawn at, in world units. */
const ON_TOLERANCE = 0.35;
/** Slack on a point it may not reach, in world units. */
const OFF_TOLERANCE = 0.35;

/** How many of the footprint's four corners the pad has to be drawn at. */
const MOST = 3;

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

it("marks the pad on the obstacle's top face at the target height", async () => {
  await openSite(h, SITE);
  await h.debug.clearStructure();
  await addOneLoad(h, CLASS, MASS, START, TARGET);
  await h.advance(1);
  await h.capture("shelf-pad", "The pad marked on the platform's top");

  const site = await h.snapshot();
  assertEqual(
    site.site.obstacles.length,
    1,
    "the obstacles High Shelf carries, the platform this point's pad sits on " +
      "(specs/sites.md)",
  );
  const platform = site.site.obstacles[0]!;
  assertEqual(
    platform.min.y + platform.size.y,
    TOP_Y,
    "the height of the platform's top face, which the container's target pose " +
      "rests its footprint on (specs/world.md § Obstacles)",
  );

  // The container's footprint at yaw 90: two units along x, four along z,
  // centred under the target position, on the platform's top face.
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const corners: { where: string; x: number; z: number }[] = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      corners.push({
        where: `(${TARGET.x + (sx * size.z) / 2}, ${TOP_Y}, ${
          TARGET.z + (sz * size.x) / 2
        })`,
        x: TARGET.x + (sx * size.z) / 2,
        z: TARGET.z + (sz * size.x) / 2,
      });
    }
  }
  // The rest of the platform's top: the strips either side of the footprint.
  const rest = [
    { where: `(${TARGET.x + 1.6}, ${TOP_Y}, 0)`, x: TARGET.x + 1.6, z: 0 },
    { where: `(${TARGET.x - 1.6}, ${TOP_Y}, 0)`, x: TARGET.x - 1.6, z: 0 },
  ];

  const before = bodies(h);
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

  assertGreaterThan(
    corners.filter(
      (corner) =>
        changedNear(
          changed,
          { x: corner.x, y: TOP_Y, z: corner.z },
          ON_TOLERANCE,
        ) > 0,
    ).length,
    MOST - 1,
    "the corners of the container's footprint on the platform's top face — " +
      `${corners.map((corner) => corner.where).join(", ")} — that the pad is ` +
      "drawn at, out of 4, since a target pose on an obstacle is drawn as a " +
      "footprint on that obstacle's top (specs/world.md § Pads)",
  );

  for (const point of rest) {
    assertLessThanOrEqual(
      changedNear(changed, { x: point.x, y: TOP_Y, z: point.z }, OFF_TOLERANCE),
      0,
      `the platform's top face at ${point.where}, outside the container's ` +
        "footprint, which moving the pad may not change because a pad is the " +
        "class outline at the target pose rather than a mark over the whole " +
        "face (specs/world.md § Pads)",
    );
  }
});
