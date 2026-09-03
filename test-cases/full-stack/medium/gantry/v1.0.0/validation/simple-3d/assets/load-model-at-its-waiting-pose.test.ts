// assets/load-model-at-its-waiting-pose — a waiting load is drawn where the site
// starts it.
//
// specs/assets.md, "The models": "The game draws each model wherever its subject
// is: … and each load at its pose, waiting, hanging, or placed."
// specs/world.md, "Loads": "Every load pose in this specification is the pose of
// the load's lift point: the center of its top face. … The load's box extends
// half its width and half its depth horizontally from the lift point, rotated by
// its yaw, and its full height below it."
//
// WHAT IS READ, AND WHY IT IS A BEFORE AND AFTER. How a build draws a crate is
// the build's — its own sculpt, its own colors, its own lighting. What
// specs/assets.md fixes is WHERE it is drawn. So the yard is emptied to nothing,
// the frame is photographed, exactly one load is added at a known starting pose
// with the camera untouched, and the frame is photographed again: the picture
// inside the load's own box has to change, and the picture outside it may not.
//
// WHERE THE BOX IS, IS FIXED IN WORLD UNITS, AND THIS IS THIS ENGINE'S HALF OF
// THE POINT. Under this engine the yard is the engine's own retained scene —
// "what `render` added on one frame is still there on the next… this is what lets
// a check find an object by name and read its world position with no pixels
// involved" (`rendering.ts`) — and this process has no GPU, so there is no frame
// to photograph. There are the bodies the build put in the scene, read in the
// units specs/world.md states the class box in. An engineless build's version of
// this point projects the box's eight corners and compares the page's own frame
// inside and outside that hull; here the box is a box in the world and the
// containment is checked where the specification states it.
//
// THE MARGIN IS AN HONEST TOLERANCE. specs/assets.md says the load models "fill
// their class boxes" and that the figures are "the intent, not a tolerance", and
// a build draws the pad's footprint and its yaw mark under the load as well. So
// a little of the drawing falls outside the mathematical box; the margin is a
// quarter of the box's own size, which is room for that and still far short of
// anywhere else in the yard.
//
// AND THE STAGE THAT MAY NOT CHANGE IS THE YARD AROUND THE LOAD, not the whole
// frame. specs/ui.md fixes what the build screen's readouts show, but a build is
// free to put more beside them — a count of the yard's loads, say — and a
// validator that held the whole frame still would fail such a build for a
// flourish the specification neither asks for nor forbids. What it cannot be
// free about is WHERE the load itself is drawn, so the ring of yard around the
// load's own box is what is held still: a load drawn beside its starting pose
// rather than at it lands in that ring.
//
// THE TARGET IS LEFT WHERE `addLoad` PUTS IT — equal to the starting pose
// (specs/instrumentation.md) — so the pad is drawn under the load rather than
// somewhere else, and the one change this point measures stays one change.
//
// The picture is compared as PNG bytes off the page rather than as pixels off a
// canvas: an engineless build draws the yard through WebGL, so the only place
// the yard and the screen layer exist together is the page's own composited
// frame.

import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertEqual, fail } from "../assert";
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

/** The load this point poses: one crate, well clear of the site's anchors. */
const CLASS = "crate" as const;
const MASS = 40;
const START: LoadPose = { x: 7, y: 2, z: -3, yaw: 0 };

/** Slack around the projected hull, as a share of the box's own drawn size. */
const MARGIN_SHARE = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One body the yard shows, and where it stands in the world. */
interface Body {
  signature: string;
  box: THREE.Box3;
}

/**
 * Every body the yard SHOWS, with its world extent.
 *
 * Hidden bodies draw nothing: a build is free to keep a pool and hide what it is
 * not using, and the engine's scene retains both.
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
    const material = (object as THREE.Mesh)
      .material as Partial<THREE.MeshStandardMaterial> | undefined;
    found.push({
      signature: [
        object.type,
        box.min.toArray().map((one) => one.toFixed(3)).join(),
        box.max.toArray().map((one) => one.toFixed(3)).join(),
        material?.color?.getHexString() ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Every body one reading shows that the other does not, either way round. */
function differing(before: readonly Body[], after: readonly Body[]): Body[] {
  const was = new Set(before.map((body) => body.signature));
  const now = new Set(after.map((body) => body.signature));
  return [
    ...after.filter((body) => !was.has(body.signature)),
    ...before.filter((body) => !now.has(body.signature)),
  ];
}

/** The class box a load of `CLASS` occupies at `pose` (specs/world.md). */
function classBox(pose: {
  x: number;
  y: number;
  z: number;
  yaw: number;
}): THREE.Box3 {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const radians = (pose.yaw * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const box = new THREE.Box3();
  for (const dx of [-size.x / 2, size.x / 2]) {
    for (const dz of [-size.z / 2, size.z / 2]) {
      for (const dy of [-size.y, 0]) {
        box.expandByPoint(
          new THREE.Vector3(
            pose.x + dx * cos - dz * sin,
            pose.y + dy,
            pose.z + dx * sin + dz * cos,
          ),
        );
      }
    }
  }
  return box;
}

/** That box with room around it for whatever a build draws on the model. */
function around(pose: {
  x: number;
  y: number;
  z: number;
  yaw: number;
}): THREE.Box3 {
  const box = classBox(pose);
  const size = box.getSize(new THREE.Vector3());
  return box.expandByScalar(MARGIN_SHARE * Math.max(size.x, size.y, size.z));
}

it("draws a waiting load inside its class box at its starting pose", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);

  const empty = await h.snapshot();
  assertEqual(empty.screen, "build", "the screen opening a site shows");
  assertEqual(
    empty.site.loads.length,
    0,
    "the loads standing in the emptied yard, before the one this point poses",
  );

  const before = bodies(h);

  await addOneLoad(h, CLASS, MASS, START, START);
  await h.advance(1);
  await h.capture("waiting", "The waiting load drawn in its class box");

  assertEqual(
    (await h.snapshot()).site.loads.length,
    1,
    "the loads standing in the yard once one is posed",
  );

  const added = differing(before, bodies(h));
  if (added.length === 0) {
    fail(
      "the yard to draw a body where the waiting load stands, since the game " +
        "draws each load at its pose (specs/assets.md § The models)",
      "nothing was added to the yard the load was posed in",
    );
  }

  const box = around(START);
  const spilled = added.filter((body) => !box.containsBox(body.box));
  if (spilled.length > 0) {
    const one = spilled[0]!;
    fail(
      "everything posing the load added to the yard to stand inside the class " +
        `box it occupies at (${START.x}, ${START.y}, ${START.z}), within a ` +
        `${MARGIN_SHARE} share of that box either way, since the game draws ` +
        "each load at its pose and the load models fill their class boxes " +
        "(specs/assets.md, specs/world.md § Loads)",
      `${spilled.length} of the ${added.length} added bodies reach outside ` +
        `it: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
