// assets/hook-model-at-the-bob — the hook block is drawn at the bob.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … the hook at the bob turned to the grip's yaw …". specs/rigging.md § The
// pivot and the bob says what the bob is: "What hangs at its end is the bob: the
// hook alone, of mass `HOOK_MASS`, or the hook with the attached load… The hook
// point and the attached load's lift point are both the bob's position."
//
// TWO POSES, BECAUSE ONE WOULD NOT SAY THE BLOCK FOLLOWS THE BOB. A block drawn
// at a fixed point of the crane — under the carriage, say, or at the track's
// origin — answers one pose and not the other. So the bob is read hanging
// straight under a carriage part-way along the track, and again swung thirty
// degrees out from a carriage at the far end: two places a full lattice pitch
// apart, each with its own box.
//
// THE TOLERANCE IS A BOX AROUND THE BOB, two units each way: room for any block a
// build sculpts to the `0.6 x 1 x 0.6` units specs/assets.md gives as the intent,
// and for the larger stand-in drawn in its place, while still leaving the
// carriage the cable's three units above it outside.

// WHERE THE MODEL IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE,
// not by placing the subject and looking at what changed. Placing anything in the
// yard legitimately redraws parts of the picture that have nothing to do with
// where the model goes — a cost readout, a member's colour. Two harnesses stand
// the same build up, posed identically and answered the same in every respect but
// the bytes under `assets/models/hook.glb`; what differs between them is
// exactly what that model draws, and this point asks where it is.
//
// THE FILE IS MATCHED BY ITS BYTES, NEVER BY ITS PATH. What a bundler names the
// copy it emits into `dist/` is the build's business — specs/assets.md asks only
// that each asset be referenced page-relative through the bundler — so an
// answered request is recognized by comparing it against the bytes of the
// committed file rather than against any path.
//
// THIS ENGINE'S HALF OF THE POINT IS WHERE THE DIFFERENCE IS READ. Under this
// engine the yard is the engine's own retained scene — "what `render` added on
// one frame is still there on the next… this is what lets a check find an object
// by name and read its world position with no pixels involved" (`rendering.ts`)
// — and this process has no GPU, so there are no pixels to compare. What there is
// instead is the bodies the build put in the scene, read in WORLD units, which is
// where the specification states the placement: the bodies that differ between
// the two builds are the model's, and every one of them has to stand inside the
// extent the requirement allows it.

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

/**
 * The two poses: a carriage part-way along the track with the bob hanging
 * straight under it, and the carriage at the far end with the bob swung out
 * thirty degrees, at the same cable length either way.
 */
const CABLE = 3;
const POSES: readonly { name: string; trolley: number; bob: Vec3 }[] = [
  { name: "hanging under the carriage", trolley: 2, bob: { x: 2, y: 1, z: 0 } },
  {
    name: "swung out from the carriage",
    trolley: 4,
    bob: {
      x: 4 + CABLE * Math.sin(Math.PI / 6),
      y: 4 - CABLE * Math.cos(Math.PI / 6),
      z: 0,
    },
  },
];

/** How far around the bob the block's drawing is held, in world units. */
const HALF = 2;

/** Stand the minimal crane up and leave the bare hook hanging still at `pose`. */
async function poseHook(
  h: Harness,
  pose: (typeof POSES)[number],
): Promise<Vec3> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", pose.trolley);
  await h.debug.setAxis("hoist", CABLE);
  await h.debug.setBob(pose.bob.x, pose.bob.y, pose.bob.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  const gap = Math.hypot(
    run.bob.pos.x - pose.bob.x,
    run.bob.pos.y - pose.bob.y,
    run.bob.pos.z - pose.bob.z,
  );
  if (gap > 0.25) {
    fail(
      `the bob to stay within a quarter unit of the pose it was put at ` +
        `${pose.name}, on a cable of exactly that length, so this point reads ` +
        "a block standing still (specs/rigging.md)",
      `it stands ${gap.toFixed(3)} away`,
    );
  }
  return run.bob.pos;
}

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
        (object as THREE.Mesh).geometry?.getAttribute("position")?.count ?? "",
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

it("draws the hook block at the bob, wherever the bob is", async () => {
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

  for (const pose of POSES) {
    const bob = await poseHook(served, pose);
    const before = bodies(served);
    if (pose === POSES[0]) {
      await served.capture("hook", "The hook block drawn at the bob");
    }

    const other = await createHarness({
      substituteAssets: [{ from: subject, to: standIn }],
    });
    substituted = other;
    await poseHook(other, pose);
    const after = bodies(other);

    assertGreaterThan(
      other.substitutedAssets(),
      0,
      "the responses the build was answered with the bytes of the committed " +
        `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
        "commit and wire in — a build that never asks for that file draws no " +
        "hook from it",
    );

    const parted = differing(before, after);
    assertGreaterThan(
      parted.length,
      0,
      `the hook to be drawn from its produced model with the bob ${pose.name}, ` +
        "so that what follows is a reading of where the block is rather than " +
        "of a build drawing no block (specs/assets.md)",
    );

    const box = new THREE.Box3(
      new THREE.Vector3(bob.x - HALF, bob.y - HALF, bob.z - HALF),
      new THREE.Vector3(bob.x + HALF, bob.y + HALF, bob.z + HALF),
    );
    const spilled = parted.filter((body) => !box.containsBox(body.box));
    if (spilled.length > 0) {
      const one = spilled[0]!;
      fail(
        `the hook drawn within ${HALF} units of the bob at ` +
          `(${bob.x.toFixed(2)}, ${bob.y.toFixed(2)}, ${bob.z.toFixed(2)}), ` +
          `${pose.name}, so serving other bytes under ` +
          `assets/models/${SUBJECT}.glb changes nothing elsewhere in the yard ` +
          "(specs/assets.md, specs/rigging.md)",
        `${spilled.length} of the ${parted.length} bodies that differ reach ` +
          `outside it: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
          `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
      );
    }

    await other.dispose();
    substituted = null;
  }
});
