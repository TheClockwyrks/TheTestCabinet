// assets/ring-drawn-from-a-produced-model — the slew ring in the yard is the
// committed `ring` model, decoded and drawn.
//
// specs/assets.md opens with the whole of the requirement: the build "produces
// every model and sound the game uses with them, commits the produced files, and
// wires them in", each committed as `assets/models/<model>.glb` "under the model
// name the table below gives it", and "the name a file carries is what says which
// subject or which cue it is". The table's first row is `ring`, "the slew ring: a
// squat bearing drum between its flanges". § What is drawn in code draws the line
// from the other side: the yard, the aids, the members, the cable, the pads and
// every readout are the build's own geometry, and the eight models are not.
//
// THE WORLD IS THE RING ALONE. specs/structure.md refuses a ring only for a second
// ring, the envelope, a base corner on the ground, the arm-to-tower rule and the
// budget, so a ring stands with nothing else built — which is the world this point
// wants: no members, no loads, no obstacles, no tape.
//
// SO THE READING IS THE FILE'S CONTENTS. A ring drawn from the committed file
// and one drawn as geometry the build wrote look alike in the yard; what tells
// them apart is running the build with DIFFERENT BYTES under that file. Two
// harnesses stand the same build up, posed identically: one with everything as it
// is committed, one where every response carrying the bytes of
// `assets/models/ring.glb` is answered with the bytes of another of the build's
// own committed models instead. A ring drawn from the produced file is then
// drawn as that other model, and what stands where the ring stands changes; a
// ring drawn in code does not move.
//
// SUBSTITUTED RATHER THAN WITHHELD. Withholding the file would be the sharper
// probe and is not a fair one: a build is free to await its whole produced asset
// set before it stands the game up, so a missing model can legitimately leave no
// game at all, and every point would then fail on a build that had done exactly
// what specs/assets.md asked. The substitute is one of the build's OWN committed
// models, so it decodes through the same loader and the game comes up normally.
//
// THE FILE IS MATCHED BY ITS BYTES, NEVER BY ITS PATH. What a bundler names the
// copy it emits into `dist/` is the build's business — specs/assets.md asks only
// that each asset be referenced page-relative through the bundler — so each
// answered request is compared against the bytes of the committed file rather
// than against any path.
//
// THIS ENGINE'S HALF OF THE POINT IS WHERE THE DIFFERENCE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so there are no pixels to compare two pages of.
// What there is instead is the bodies the build put in the scene, and the reading
// is the same one either way: what is drawn where the ring stands must change
// when the bytes under its file change, and everything drawn elsewhere in the
// yard must not. Nothing is found by name; what a build calls the objects it
// renders is its own, and where it puts them is not.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import { LATTICE_PITCH } from "../constants";
import { clearAll, createHarness, openSite, type Harness } from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "ring";
const STAND_IN = "hook";

const SITE = 0;

/** The ring's base corner: off the ground, so specs/structure.md accepts it. */
const CORNER = { x: 0, y: 2, z: 0 };

/**
 * The slew axis: "the vertical line through the flange square's center",
 * `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)` (specs/structure.md).
 */
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};

/**
 * The world box the ring's drawing is held inside, centered on the slew axis.
 *
 * specs/assets.md sizes the ring "about `2.5 x 2 x 2.5` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box is half
 * again as wide as that intent and reaches a unit past each flange — room for any
 * ring a build sculpts to it, and for the smaller stand-in drawn in its place.
 */
const HALF = 2;
const Y_LOW = CORNER.y - 1;
const Y_HIGH = CORNER.y + LATTICE_PITCH + 1;

/** Stand the ring up on a bare site, with nothing else built. */
async function poseRing(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.setRing(CORNER.x, CORNER.y, CORNER.z);
  await h.advance(1);
  if ((await h.snapshot()).structure.ring === null) {
    fail(
      `the slew ring at (${CORNER.x}, ${CORNER.y}, ${CORNER.z}) to stand on an ` +
        "empty site, which specs/structure.md refuses nothing about",
      "the structure carries no ring",
    );
  }
}

/** One body the yard shows, and where it stands in the world. */
interface Body {
  /** Everything about it a redraw would have to keep to be the same body. */
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
        (object as THREE.Mesh).geometry?.getAttribute("position")?.count ?? "",
      ].join("|"),
      box,
    });
  });
  return found;
}

/** Everything the yard draws INSIDE the subject's own extent, as one value. */
function within(read: readonly Body[], box: THREE.Box3): string {
  return read
    .filter((body) => box.containsBox(body.box))
    .map((body) => body.signature)
    .sort()
    .join("\n");
}

/** Everything the yard draws that reaches OUTSIDE it, as one value. */
function beyond(read: readonly Body[], box: THREE.Box3): string {
  return read
    .filter((body) => !box.containsBox(body.box))
    .map((body) => body.signature)
    .sort()
    .join("\n");
}

/** A model specs/assets.md requires the build to have produced and committed. */
function committedModel(name: string): Uint8Array {
  try {
    return new Uint8Array(
      readFileSync(join(WORKSPACE, "assets", "models", `${name}.glb`)),
    );
  } catch {
    return fail(
      `a produced ${name} model committed at assets/models/${name}.glb, which ` +
        "specs/assets.md requires the build to produce with `voxel` and commit",
      "no such file in the build's tree",
    );
  }
}

let served: Harness;
let substituted: Harness | null = null;

beforeEach(async () => {
  served = await createHarness();
});

afterEach(async () => {
  if (substituted !== null) await substituted.dispose();
  substituted = null;
  await served.dispose();
});

it("draws the ring from the committed ring model", async () => {
  const subject = committedModel(SUBJECT);
  const standIn = committedModel(STAND_IN);
  assertTrue(
    subject.length !== standIn.length ||
      subject.some((byte, at) => byte !== standIn[at]),
    `the committed assets/models/${SUBJECT}.glb and assets/models/` +
      `${STAND_IN}.glb to be the two different models specs/assets.md asks ` +
      "the build to produce, so serving one in the other's place changes what " +
      "is drawn",
  );

  const region = new THREE.Box3(
    new THREE.Vector3(AXIS.x - HALF, Y_LOW, AXIS.z - HALF),
    new THREE.Vector3(AXIS.x + HALF, Y_HIGH, AXIS.z + HALF),
  );
  await poseRing(served);
  const before = bodies(served);
  await served.capture("ring", "The ring drawn from its produced model");

  // The same build again, with the subject's model answered by another of its
  // own — recognised by the bytes the workspace holds under it.
  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await poseRing(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "ring from it",
  );

  const outsideBefore = beyond(before, region);
  const outsideAfter = beyond(after, region);
  if (outsideBefore !== outsideAfter) {
    fail(
      "the yard outside the ring's own extent to be drawn the same whichever " +
        "model is served under the ring's file, so that what changes inside " +
        "that extent is the ring (specs/assets.md)",
      "it differs, so this build draws a different yard rather than simply a " +
        "different ring",
    );
  }

  assertTrue(
    within(before, region) !== within(after, region),
    "what the yard draws inside the ring's own extent to change when other " +
      `bytes are served under assets/models/${SUBJECT}.glb, since the ring ` +
      "in the yard is that produced model decoded and drawn rather than " +
      "geometry the build draws in code (specs/assets.md)",
  );
});
