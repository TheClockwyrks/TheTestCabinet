// assets/hook-drawn-from-a-produced-model — the block at the cable's end is the
// committed `hook` model, decoded and drawn.
//
// specs/assets.md opens with the whole of the requirement: the build "produces
// every model and sound the game uses with them, commits the produced files, and
// wires them in", each committed as `assets/models/<model>.glb` "under the model
// name the table below gives it", and "the name a file carries is what says which
// subject or which cue it is". The table's third row is `hook`, "the hook block
// at the cable's end", and § The models has the game draw "the hook at the bob
// turned to the grip's yaw". § What is drawn in code draws the line from the
// other side: the yard, the aids, the members, the cable, the pads and every
// readout are the build's own geometry, and the eight models are not.
//
// THE BLOCK IS POSED ON A RUN AND LEFT HANGING STILL. `setBob` "puts the bob
// where it is asked for, so a caller that wants a bob the cable can hold sets the
// hoist axis to the distance it left between the pivot and the bob"
// (specs/instrumentation.md) — which is exactly what is done here, so the
// pendulum's own constraint leaves it where it was put. The tape is one move that
// turns the grip, which "turns the bare hook, visibly and to no other effect"
// (specs/rigging.md), so the run stays live and nothing else in the yard moves.
//
// SO THE READING IS THE FILE'S CONTENTS. A hook drawn from the committed file
// and one drawn as geometry the build wrote look alike in the yard; what tells
// them apart is running the build with DIFFERENT BYTES under that file. Two
// harnesses stand the same build up, posed identically: one with everything as it
// is committed, one where every response carrying the bytes of
// `assets/models/hook.glb` is answered with the bytes of another of the build's
// own committed models instead. A hook drawn from the produced file is then
// drawn as that other model, and what stands where the hook stands changes; a
// hook drawn in code does not move.
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
// is the same one either way: what is drawn where the hook stands must change
// when the bytes under its file change, and everything drawn elsewhere in the
// yard must not. Nothing is found by name; what a build calls the objects it
// renders is its own, and where it puts them is not.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The build's own tree: the validator project is staged inside it. */
const WORKSPACE = new URL("../../", import.meta.url).pathname;

/** The subject's model, and the model served in its place. */
const SUBJECT = "hook";
const STAND_IN = "trolley";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The far end of the minimal crane's track, and the cable let out to reach it. */
const TROLLEY_AT = 4;
const HOIST_AT = 3;
const BOB: Vec3 = { x: 4, y: 1, z: 0 };

/**
 * The world box the block's drawing is held inside.
 *
 * specs/assets.md sizes the hook "about `0.6 x 1 x 0.6` units" and says of the
 * part figures that they "are the intent, not a tolerance", so the box reaches
 * two units each way — room for any block a build sculpts to that intent, and for
 * the larger stand-in drawn in its place.
 */
const HALF = 2;

/** Stand the minimal crane up and leave the bare hook hanging still. */
async function poseHook(h: Harness): Promise<Vec3> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setAxis("hoist", HOIST_AT);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  const gap = Math.hypot(
    run.bob.pos.x - BOB.x,
    run.bob.pos.y - BOB.y,
    run.bob.pos.z - BOB.z,
  );
  if (gap > 0.25) {
    fail(
      `the bob to stay within a quarter unit of (${BOB.x}, ${BOB.y}, ${BOB.z}) ` +
        "on the tick after it is posed there on a cable of exactly that " +
        "length, so this point reads a block standing still (specs/rigging.md)",
      `it stands ${gap.toFixed(3)} away, at (${run.bob.pos.x.toFixed(3)}, ` +
        `${run.bob.pos.y.toFixed(3)}, ${run.bob.pos.z.toFixed(3)})`,
    );
  }
  return run.bob.pos;
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

it("draws the hook from the committed hook model", async () => {
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
    new THREE.Vector3(BOB.x - HALF, BOB.y - HALF, BOB.z - HALF),
    new THREE.Vector3(BOB.x + HALF, BOB.y + HALF, BOB.z + HALF),
  );
  await poseHook(served);
  const before = bodies(served);
  await served.capture("hook", "The hook drawn from its produced model");

  // The same build again, with the subject's model answered by another of its
  // own — recognised by the bytes the workspace holds under it.
  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await poseHook(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "hook from it",
  );

  const outsideBefore = beyond(before, region);
  const outsideAfter = beyond(after, region);
  if (outsideBefore !== outsideAfter) {
    fail(
      "the yard outside the hook's own extent to be drawn the same whichever " +
        "model is served under the hook's file, so that what changes inside " +
        "that extent is the hook (specs/assets.md)",
      "it differs, so this build draws a different yard rather than simply a " +
        "different hook",
    );
  }

  assertTrue(
    within(before, region) !== within(after, region),
    "what the yard draws inside the hook's own extent to change when other " +
      `bytes are served under assets/models/${SUBJECT}.glb, since the hook ` +
      "in the yard is that produced model decoded and drawn rather than " +
      "geometry the build draws in code (specs/assets.md)",
  );
});
