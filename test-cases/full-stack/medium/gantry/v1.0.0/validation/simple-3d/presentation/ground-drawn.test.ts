// presentation/ground-drawn — the plane y = 0 is drawn as the yard floor.
//
// specs/world.md § The world frame: "The world is measured in units on a
// right-handed frame: `x` and `z` are horizontal, `y` is up, and THE GROUND IS
// THE PLANE `y = 0`, DRAWN AS THE YARD FLOOR." specs/ui.md § Build puts it in the
// list of what the build screen shows: "`build` shows the yard through the
// camera: THE GROUND, the lattice and envelope aids, the anchors, the obstacles,
// the loads at their starting poses, the pads, and the structure as built."
//
// THIS ENGINE'S HALF OF THE POINT IS WHERE THE FLOOR IS READ. Under this engine
// the yard is the engine's own retained scene — "what `render` added on one frame
// is still there on the next… this is what lets a check find an object by name
// and read its world position with no pixels involved" (`rendering.ts`) — and
// this process has no GPU, so the yard has no pixels at all. An engineless build
// owns its own renderer, so its version of this point drops the camera to its
// shallowest pitch, finds the ground plane's vanishing line through `project`,
// and reads the stage either side of it. Here the plane is a plane in the world,
// and what the requirement asks for is a surface lying in it — which is read
// where the specification states it, in world units, and needs no camera at all.
//
// WHAT A FLOOR IS, AND WHAT IT IS NOT. A body lying IN the plane `y = 0`: flat,
// so it is a floor rather than a wall or a box standing on one, and broad enough
// to be under the yard rather than a plate on one node. So a candidate is a body
// whose world extent reaches no further than `THIN` either side of `y = 0` and
// which spans at least `BROAD` units across the yard — and the floor is one that
// stands under every sampled point of the plane at once, because a floor is one
// surface and not a patchwork of the places this check happened to look.
//
// NOTHING HERE READS A COLOUR. "The yard is yours to art-direct: the palette, the
// sky, the ground, the light" (specs/overview.md § Visual design), so what the
// floor is drawn in is the build's; that it is there, in the plane the
// specification names, is not.
//
// THE POINTS ARE SPREAD ACROSS THE YARD and taken off the lattice nodes, so a
// build that laid a mark on each node rather than a floor under all of them
// answers none of them.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, fail } from "../assert";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

const SITE = 0;

/**
 * Points of the plane `y = 0`, spread across the yard.
 *
 * Off the lattice nodes — `LATTICE_PITCH` is `2` and every node's coordinates are
 * even (specs/world.md) — so nothing drawn at a node answers for one of them.
 */
const GROUND = [
  { x: 7, z: 1 },
  { x: 5, z: -3 },
  { x: -1, z: 7 },
  { x: 3, z: -1 },
] as const;

/**
 * How far either side of `y = 0` a floor may reach, in world units.
 *
 * A floor is a surface in the plane, and a build is free to give it a little
 * thickness or to lift it a hair to keep it out of the ground aids' way. A tenth
 * of a lattice pitch is that room, and far less than the height of anything that
 * stands ON the floor.
 */
const THIN = 0.2;

/**
 * How far a floor must span across the yard, in world units.
 *
 * Site one's envelope runs `x -8..12` and `z -8..12` (specs/sites.md), twenty
 * units on each axis, so a surface that is under the whole yard spans at least
 * that. Anything narrower is a plate, a pad or a patch rather than the ground.
 */
const BROAD = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every surface the yard shows lying in the plane `y = 0`, with its extent. */
function floors(harness: Harness): THREE.Box3[] {
  const found: THREE.Box3[] = [];
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
    // Hidden bodies draw nothing: a build is free to keep a pool and hide what
    // it is not using, and the engine's scene retains both.
    for (
      let node: THREE.Object3D | null = object;
      node !== null;
      node = node.parent
    ) {
      if (!node.visible) return;
    }
    object.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    if (box.min.y < -THIN || box.max.y > THIN) return;
    const size = box.getSize(new THREE.Vector3());
    if (size.x < BROAD || size.z < BROAD) return;
    // Opened out to the whole slab the plane may be drawn within, so a surface
    // laid a hair below `y = 0` — to keep it out of the ground aids' way —
    // still counts as standing under the plane's own points.
    box.min.y = Math.min(box.min.y, -THIN);
    box.max.y = Math.max(box.max.y, THIN);
    found.push(box);
  });
  return found;
}

it("draws the plane y = 0 as a floor under the yard", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  await h.capture("floor", "The empty yard and its floor");

  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen opening a site shows");

  const surfaces = floors(h);
  const under = surfaces.filter((box) =>
    GROUND.every((point) =>
      box.containsPoint(new THREE.Vector3(point.x, 0, point.z)),
    ),
  );
  if (under.length === 0) {
    const missed = GROUND.filter(
      (point) =>
        !surfaces.some((box) =>
          box.containsPoint(new THREE.Vector3(point.x, 0, point.z)),
        ),
    );
    fail(
      "one flat surface lying in the plane y = 0 — within " +
        `${THIN} of it, spanning at least ${BROAD} units on each horizontal ` +
        "axis — standing under every one of the points read, since the ground " +
        "is the plane y = 0 drawn as the yard floor and the build screen " +
        "shows it (specs/world.md § The world frame, specs/ui.md § Build)",
      surfaces.length === 0
        ? "the yard holds no such surface at all"
        : `${surfaces.length} such surface(s) stand, and none reaches ` +
          `${missed.map((p) => `(${p.x}, 0, ${p.z})`).join(", ")}`,
    );
  }
});
