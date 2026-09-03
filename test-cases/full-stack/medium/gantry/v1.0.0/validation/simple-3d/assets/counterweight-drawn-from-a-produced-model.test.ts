// assets/counterweight-drawn-from-a-produced-model — a ballast block is the
// committed `counterweight` model, decoded and drawn.
//
// specs/assets.md opens with the whole of the requirement: the build "produces
// every model and sound the game uses with them, commits the produced files, and
// wires them in", each committed as `assets/models/<model>.glb` "under the model
// name the table below gives it", and "the name a file carries is what says which
// subject or which cue it is". The table's fourth row is `counterweight`, "a
// dense ballast block", and § The models has the game draw "a counterweight at
// each carrying node". § What is drawn in code draws the line from the other
// side: the yard, the aids, the members, the cable, the pads and every readout
// are the build's own geometry, and the eight models are not.
//
// THE WORLD IS ONE MEMBER AND ONE BLOCK. specs/structure.md accepts a
// counterweight on a node the structure uses and refuses one on a bare node, so
// the smallest world this point can be read in is one strut and the block hung on
// its upper end.
//
// SO THE READING IS THE FILE'S CONTENTS. A counterweight drawn from the committed file
// and one drawn as geometry the build wrote look alike in the yard; what tells
// them apart is running the build with DIFFERENT BYTES under that file. Two
// harnesses stand the same build up, posed identically: one with everything as it
// is committed, one where every response carrying the bytes of
// `assets/models/counterweight.glb` is answered with the bytes of another of the build's
// own committed models instead. A counterweight drawn from the produced file is then
// drawn as that other model, and what stands where the counterweight stands changes; a
// counterweight drawn in code does not move.
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
// is the same one either way: what is drawn where the counterweight stands must change
// when the bytes under its file change, and everything drawn elsewhere in the
// yard must not. Nothing is found by name; what a build calls the objects it
// renders is its own, and where it puts them is not.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  type Harness,
  type Vec3,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "counterweight";
const STAND_IN = "hook";

const SITE = 0;

/** The one member the structure is: an anchor leg, well inside the envelope. */
const FOOT: Vec3 = { x: 0, y: 0, z: 0 };
const NODE: Vec3 = { x: 0, y: 2, z: 0 };

/**
 * The world box the block's drawing is held inside.
 *
 * specs/assets.md sizes the counterweight "about `1.5 x 1.5 x 1.5` units" and
 * says of the part figures that they "are the intent, not a tolerance", so the
 * box reaches two units each way — room for any block a build sculpts to that
 * intent, and for the stand-in drawn in its place.
 */
const HALF = 2;

/** One strut, and one counterweight hung on the node at its top. */
async function poseBlock(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addMember(
    FOOT.x,
    FOOT.y,
    FOOT.z,
    NODE.x,
    NODE.y,
    NODE.z,
    "strut",
  );
  await h.debug.addCounterweight(NODE.x, NODE.y, NODE.z);
  await h.advance(1);
  const { structure } = await h.snapshot();
  if (structure.counterweights.length !== 1) {
    fail(
      `one counterweight standing on (${NODE.x}, ${NODE.y}, ${NODE.z}), a ` +
        "node the structure uses, which specs/structure.md accepts",
      `${structure.counterweights.length} stand`,
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

it("draws a counterweight from the committed counterweight model", async () => {
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
    new THREE.Vector3(NODE.x - HALF, NODE.y - HALF, NODE.z - HALF),
    new THREE.Vector3(NODE.x + HALF, NODE.y + HALF, NODE.z + HALF),
  );
  await poseBlock(served);
  const before = bodies(served);
  await served.capture("counterweight", "The counterweight drawn from its produced model");

  // The same build again, with the subject's model answered by another of its
  // own — recognised by the bytes the workspace holds under it.
  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await poseBlock(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "counterweight from it",
  );

  const outsideBefore = beyond(before, region);
  const outsideAfter = beyond(after, region);
  if (outsideBefore !== outsideAfter) {
    fail(
      "the yard outside the counterweight's own extent to be drawn the same whichever " +
        "model is served under the counterweight's file, so that what changes inside " +
        "that extent is the counterweight (specs/assets.md)",
      "it differs, so this build draws a different yard rather than simply a " +
        "different counterweight",
    );
  }

  assertTrue(
    within(before, region) !== within(after, region),
    "what the yard draws inside the counterweight's own extent to change when other " +
      `bytes are served under assets/models/${SUBJECT}.glb, since the counterweight ` +
      "in the yard is that produced model decoded and drawn rather than " +
      "geometry the build draws in code (specs/assets.md)",
  );
});
