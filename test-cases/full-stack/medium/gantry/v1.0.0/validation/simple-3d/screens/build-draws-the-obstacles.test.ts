// screens/build-draws-the-obstacles — the build screen draws an obstacle as the
// box it occupies.
//
// specs/ui.md, "Build": "`build` shows the yard through the camera: the ground,
// the lattice and envelope aids, the anchors, the obstacles, the loads at their
// starting poses, the pads, and the structure as built". An obstacle is a box —
// specs/world.md and the site tables give each one as a minimum corner and a
// size, and specs/structure.md refuses anything that reaches inside that box —
// so drawing an obstacle is drawing that box where the camera puts it.
//
// THE READING IS A BEFORE AND AFTER, because what a build draws an obstacle as
// is entirely its own: a solid, a wireframe, a hatched slab. What is fixed is
// that adding one CHANGES the picture, and that the change lands where the box
// is. So the yard is emptied to nothing — no structure, no loads, no obstacles —
// the yard is read, one obstacle is posed with the camera untouched, and the yard
// is read again.
//
// THIS ENGINE'S HALF OF THE POINT IS WHERE THE PICTURE IS READ, and here it is
// read IN THE WORLD rather than on the stage. Under this engine the yard is the
// engine's own retained scene — "what `render` added on one frame is still there
// on the next… this is what lets a check find an object by name and read its world
// position with no pixels involved" — and this process has no GPU, so the yard has
// no pixels at all. An engineless build owns its own renderer, so its version of
// this point projects the box's eight corners and compares the page's composited
// frame inside and outside that hull; here the box is a box in world units and
// what the build added to draw it is a body in the same units, so the containment
// is checked where the specification states it. That is the stronger reading of
// the two: a body drawn in the right part of the picture but at the wrong depth
// passes there and fails here.
//
// THE MARGIN IS AN HONEST TOLERANCE, not a fudge. A build draws a solid with an
// edge of some stroke width, may mark it as an obstacle rather than a plain block,
// and is free to lay a shadow on the ground under it — so a little of the drawing
// stands outside the box's own eight corners. The margin is a quarter of the box's
// largest side, which is room for all of that and still far short of anywhere else
// in the yard: everything the build adds has to fall inside it, and that is what
// tells a box drawn where the obstacle stands from a block drawn somewhere else.
//
// AND NOTHING MAY BE TAKEN AWAY. Posing an obstacle adds an obstacle to the site
// and changes nothing else (`specs/instrumentation.md`), so a build that dropped
// or moved something else in the yard to make room for it is drawing a different
// yard from the one the state describes.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

const SITE = 0;

/**
 * The obstacle: a box standing clear of the anchors and of the crane's lattice
 * corner, so nothing else in the yard stands where it does.
 */
const MIN: Vec3 = { x: 4, y: 0, z: -2 };
const SIZE: Vec3 = { x: 2, y: 4, z: 4 };

/** Slack around the box, as a share of its largest side, in world units. */
const MARGIN_SHARE = 0.25;

/** One body the build drew, and where it stands in the world. */
interface Body {
  /** Everything about it that a redraw would have to keep to be the same body. */
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard is drawn from, with its world extent.
 *
 * A body is anything the build put in the scene that occupies space — a mesh, a
 * line, a cloud of points. Lights and bare groups occupy none and are skipped:
 * they carry no extent for a containment rule to be about.
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
        object.name,
        object.visible ? "1" : "0",
        box.min.toArray().map((one) => one.toFixed(4)).join(),
        box.max.toArray().map((one) => one.toFixed(4)).join(),
        material?.color?.getHexString() ?? "",
        material?.opacity ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** How many of each signature a reading holds. */
function counted(read: readonly Body[]): Map<string, number> {
  const tally = new Map<string, number>();
  for (const body of read) {
    tally.set(body.signature, (tally.get(body.signature) ?? 0) + 1);
  }
  return tally;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws a posed obstacle inside the box's own extent", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const posed = await h.snapshot();
  assertEqual(posed.screen, "build", "the screen opening a site shows");
  assertEqual(
    posed.site.obstacles.length,
    0,
    "the obstacles standing in the emptied yard, before the one this point " +
      "poses",
  );

  const before = bodies(h);
  const was = counted(before);

  await h.debug.addObstacle(MIN.x, MIN.y, MIN.z, SIZE.x, SIZE.y, SIZE.z);
  await h.advance(1);
  await h.capture("obstacle-drawn", "A posed obstacle drawn in the yard");

  assertEqual(
    (await h.snapshot()).site.obstacles.length,
    1,
    "the obstacles standing in the yard once one is posed",
  );

  const after = bodies(h);
  const now = counted(after);

  const added = after.filter(
    (body) =>
      (now.get(body.signature) ?? 0) > (was.get(body.signature) ?? 0),
  );
  if (added.length === 0) {
    fail(
      "the yard to draw a body where the posed obstacle stands, since the " +
        "build screen shows the yard's obstacles (specs/ui.md)",
      "nothing was added to the yard the obstacle was posed in",
    );
  }

  const margin = MARGIN_SHARE * Math.max(SIZE.x, SIZE.y, SIZE.z);
  const allowed = new THREE.Box3(
    new THREE.Vector3(MIN.x - margin, MIN.y - margin, MIN.z - margin),
    new THREE.Vector3(
      MIN.x + SIZE.x + margin,
      MIN.y + SIZE.y + margin,
      MIN.z + SIZE.z + margin,
    ),
  );
  const spilled = added.filter((body) => !allowed.containsBox(body.box));
  if (spilled.length > 0) {
    const one = spilled[0]!;
    fail(
      `everything posing the obstacle added to the yard to stand inside the ` +
        `box it occupies, within ${margin.toFixed(2)} world units, because ` +
        "an obstacle is drawn as the box it occupies (specs/ui.md, " +
        "specs/world.md)",
      `${spilled.length} of ${added.length} added bodies reach outside it: ` +
        `one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }

  const removed = before.filter(
    (body) =>
      (now.get(body.signature) ?? 0) < (was.get(body.signature) ?? 0),
  );
  if (removed.length > 0) {
    const one = removed[0]!;
    fail(
      "posing an obstacle to leave the rest of the yard as it was, since it " +
        "adds an obstacle to the site and sets nothing else " +
        "(specs/instrumentation.md)",
      `${removed.length} bodies the yard was drawn from are gone or moved: ` +
        `one spanned (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
