// presentation/pad-outline-turned-to-the-target-yaw — a pad's outline is turned
// to the target yaw.
//
// specs/world.md § Pads: "A load's target pose is drawn as its pad: a marked
// footprint on the ground or on an obstacle's top, showing the class outline at
// the target yaw." specs/overview.md § Visual design asks for the same thing from
// the player's side: "each pad's footprint and required yaw are marked so a site
// is readable before anything is built".
//
// THE LOAD IS A CONTAINER, because its class box is `4 x 2 x 2`
// (specs/world.md § Loads) and so its footprint is a rectangle rather than a
// square: four units along `x` and two along `z` at yaw `0`, and the other way
// round at yaw `90`, since "a positive yaw turns `+x` toward `+z`"
// (specs/world.md § The world frame). A crate's square footprint would look the
// same at both yaws and could decide nothing.
//
// THREE READINGS, because "drawn at" is a comparison and not a colour. The pad is
// first put somewhere else entirely, giving a picture of the ground with no pad
// on it; then the target is set at yaw `0`, and then at yaw `90`, with the load's
// own body and the camera untouched throughout. A corner the outline reaches is a
// point that changed from the pad-free picture; a corner it does not reach is one
// that did not.
//
// THE FOUR CORNERS OF EACH TURN ARE THE READING. At yaw `0` the footprint's
// corners are `(±2, 0, 8 ± 1)`; at yaw `90` they are `(±1, 0, 8 ± 2)`. Each set
// lies a whole unit outside the other footprint, which is far more than any
// stroke width, so an outline that stood square at both yaws — or one that turned
// the wrong way — is told apart from one that turned with the target.
//
// The tolerances are the same as every pad reading in this category, in the world
// units this engine reads the yard in: a third of a unit of slack for a stroke of
// the build's own width where the outline should be, twice that where it may not
// reach. A corner of one turn stands a whole unit outside the other footprint, so
// the two are told apart with room to spare.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/** The load: the one class whose footprint is not square. */
const CLASS = "container";
const MASS = 90;
const START = { x: 10, y: 2, z: 0, yaw: 0 } as const;

/** Where the pad is asked for, and where it is parked for the bare picture. */
const TARGET = { x: 0, y: 2, z: 8 } as const;
const ELSEWHERE = { x: -10, y: 2, z: -6, yaw: 0 } as const;

/** Slack on a point the outline is drawn at, in world units. */
const ON_TOLERANCE = 0.35;
/** Slack on a point it may not reach, in world units. */
const OFF_TOLERANCE = 0.7;

/** How many of a turn's four corners the outline has to reach. */
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

it("turns the pad's outline to the target yaw", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addLoad(CLASS, MASS, START.x, START.y, START.z, START.yaw);

  // The corners of the class box's footprint at each yaw, on the ground under
  // the target position (specs/world.md § Loads: the box "extends half its
  // width and half its depth horizontally from the lift point, rotated by its
  // yaw").
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const corners = (yaw: number): { where: string; x: number; z: number }[] => {
    const along = yaw === 0 ? size.x / 2 : size.z / 2;
    const across = yaw === 0 ? size.z / 2 : size.x / 2;
    const out: { where: string; x: number; z: number }[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push({
          where: `(${TARGET.x + sx * along}, 0, ${TARGET.z + sz * across})`,
          x: TARGET.x + sx * along,
          z: TARGET.z + sz * across,
        });
      }
    }
    return out;
  };
  const square = corners(0);
  const turned = corners(90);

  // The ground with this load's pad nowhere near it.
  await h.debug.setLoadTarget(
    0,
    ELSEWHERE.x,
    ELSEWHERE.y,
    ELSEWHERE.z,
    ELSEWHERE.yaw,
  );
  await h.advance(1);
  const bare = bodies(h);

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, 0);
  await h.advance(1);
  const atZero = changedBodies(bare, bodies(h));

  await h.debug.setLoadTarget(0, TARGET.x, TARGET.y, TARGET.z, 90);
  await h.advance(1);
  const atNinety = changedBodies(bare, bodies(h));
  await h.capture("pad-yaw", "The same pad at yaw 0 and yaw 90");

  const reached = (
    changed: readonly Body[],
    corner: { x: number; z: number },
  ): boolean =>
    changedNear(changed, { x: corner.x, y: 0, z: corner.z }, ON_TOLERANCE) > 0;
  const clear = (
    changed: readonly Body[],
    corner: { x: number; z: number },
  ): boolean =>
    changedNear(changed, { x: corner.x, y: 0, z: corner.z }, OFF_TOLERANCE) ===
    0;

  assertGreaterThan(
    square.filter((corner) => reached(atZero, corner)).length,
    MOST - 1,
    `the corners of the ${CLASS}'s footprint at yaw 0 — ` +
      `${square.map((corner) => corner.where).join(", ")} — that the pad is ` +
      "drawn at, out of 4, since a pad shows the class outline at the target " +
      "yaw (specs/world.md § Pads)",
  );
  assertGreaterThan(
    turned.filter((corner) => clear(atZero, corner)).length,
    3,
    `the corners of the ${CLASS}'s footprint at yaw 90 — ` +
      `${turned.map((corner) => corner.where).join(", ")} — that the pad at ` +
      "yaw 0 leaves unmarked, out of 4: a pad turned to a yaw of 0 reaches " +
      "only its own footprint (specs/world.md § Pads)",
  );

  assertGreaterThan(
    turned.filter((corner) => reached(atNinety, corner)).length,
    MOST - 1,
    `the corners of the ${CLASS}'s footprint at yaw 90 — ` +
      `${turned.map((corner) => corner.where).join(", ")} — that the pad is ` +
      "drawn at once the target asks for a quarter turn, out of 4 " +
      "(specs/world.md § Pads)",
  );
  assertGreaterThan(
    square.filter((corner) => clear(atNinety, corner)).length,
    3,
    `the corners of the ${CLASS}'s footprint at yaw 0 — ` +
      `${square.map((corner) => corner.where).join(", ")} — that the pad at ` +
      "yaw 90 leaves unmarked, out of 4: an outline that stood square would " +
      "reach them at both yaws (specs/world.md § Pads)",
  );
});
