// assets/crate-drawn-from-a-produced-model — the crate in the yard is the
// committed `crate` model, decoded and drawn.
//
// specs/assets.md opens with the whole of the requirement: the build "produces
// every model and sound the game uses with them, commits the produced files, and
// wires them in", each committed as `assets/models/<model>.glb` "under the model
// name the table below gives it", and "the name a file carries is what says which
// subject or which cue it is". The table's sixth row is `crate`, "the `crate` load
// class", and § The models has the game draw "each load at its pose, waiting,
// hanging, or placed". § What is drawn in code draws the line from the other
// side: the yard, the aids, the members, the cable, the pads and every readout
// are the build's own geometry, and the eight models are not.
//
// THE WORLD IS ONE LOAD. Nothing is built, no obstacle stands and no other load
// waits, so the only thing standing where the crate stands is the crate.
//
// SO THE READING IS THE FILE'S CONTENTS. A crate drawn from the committed file
// and one drawn as geometry the build wrote look alike in the yard; what tells
// them apart is running the build with DIFFERENT BYTES under that file. Two
// harnesses stand the same build up, posed identically: one with everything as it
// is committed, one where every response carrying the bytes of
// `assets/models/crate.glb` is answered with the bytes of another of the build's
// own committed models instead. A crate drawn from the produced file is then
// drawn as that other model, and what stands where the crate stands changes; a
// crate drawn in code does not move.
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
// is the same one either way: what is drawn where the crate stands must change
// when the bytes under its file change, and everything drawn elsewhere in the
// yard must not. Nothing is found by name; what a build calls the objects it
// renders is its own, and where it puts them is not.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "crate";
const STAND_IN = "hook";

const SITE = 0;
const CLASS = "crate" as const;
const MASS = 40;

/** Where the one load stands: clear of the site's anchors, out in the open. */
const GROUND = { x: 7, z: -3 };

/**
 * How far past its own class box the load's drawing is held.
 *
 * The three load models "fill their class boxes" (specs/assets.md), so the box is
 * where the crate is drawn; a unit of room around it takes any lip, handle or rim
 * a build sculpts on, and the stand-in drawn in its place.
 */
const PAD = 1;

/** One load, waiting on the ground, in an otherwise empty yard. */
async function poseLoad(h: Harness): Promise<LoadPose> {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  // A load pose is the pose of its lift point, the centre of its top face, so a
  // load resting on the ground carries its lift point at its own class height
  // (specs/world.md § Loads).
  const pose: LoadPose = { x: GROUND.x, y: size.y, z: GROUND.z, yaw: 0 };
  await openSite(h, SITE);
  await clearAll(h);
  await addOneLoad(h, CLASS, MASS, pose, pose);
  await h.advance(1);
  const { site } = await h.snapshot();
  if (site.loads.length !== 1) {
    fail(
      `one ${CLASS} waiting in the emptied yard, which this point reads the ` +
        "drawing of (specs/world.md)",
      `${site.loads.length} loads stand`,
    );
  }
  return pose;
}

/** The block of yard the load's own class box stands in, with room around it. */
function loadBox(pose: LoadPose): THREE.Box3 {
  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  return new THREE.Box3(
    new THREE.Vector3(
      pose.x - size.x / 2 - PAD,
      pose.y - size.y - PAD,
      pose.z - size.z / 2 - PAD,
    ),
    new THREE.Vector3(
      pose.x + size.x / 2 + PAD,
      pose.y + PAD,
      pose.z + size.z / 2 + PAD,
    ),
  );
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

it("draws the crate from the bytes of its produced model file", async () => {
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

  const region = loadBox(await poseLoad(served));
  const before = bodies(served);
  await served.capture("crate", "The crate drawn from its produced model");

  // The same build again, with the subject's model answered by another of its
  // own — recognised by the bytes the workspace holds under it.
  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await poseLoad(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "crate from it",
  );

  const outsideBefore = beyond(before, region);
  const outsideAfter = beyond(after, region);
  if (outsideBefore !== outsideAfter) {
    fail(
      "the yard outside the crate's own extent to be drawn the same whichever " +
        "model is served under the crate's file, so that what changes inside " +
        "that extent is the crate (specs/assets.md)",
      "it differs, so this build draws a different yard rather than simply a " +
        "different crate",
    );
  }

  assertTrue(
    within(before, region) !== within(after, region),
    "what the yard draws inside the crate's own extent to change when other " +
      `bytes are served under assets/models/${SUBJECT}.glb, since the crate ` +
      "in the yard is that produced model decoded and drawn rather than " +
      "geometry the build draws in code (specs/assets.md)",
  );
});
