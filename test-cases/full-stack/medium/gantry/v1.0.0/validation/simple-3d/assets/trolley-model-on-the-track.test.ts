// assets/trolley-model-on-the-track — the trolley is drawn on the track, at the
// trolley axis's own position.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … the trolley on the track at the trolley position …". specs/rigging.md
// fixes what that position is: the trolley point is "on the rail track at the
// trolley's position, rotated with the arm", and specs/structure.md fixes the
// track as the rail run from its origin outward. So with the axis posed at the
// far end of the minimal crane's four-unit track, the model belongs there and not
// at the origin it started from.
//
// THE TOLERANCE IS A BOX AROUND THE CARRIAGE'S POINT, two units each way: room
// for any carriage a build sculpts to the `1.5 x 1 x 1.5` units specs/assets.md
// gives as the intent, and for the stand-in drawn in its place, while still
// leaving the track's origin four units outside it.

// WHERE THE MODEL IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE,
// not by placing the subject and looking at what changed. Placing anything in the
// yard legitimately redraws parts of the picture that have nothing to do with
// where the model goes — a cost readout, a member's colour. Two harnesses stand
// the same build up, posed identically and answered the same in every respect but
// the bytes under `assets/models/trolley.glb`; what differs between them is
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
import { GRIP_MAX_RATE, HOIST_START } from "../constants";
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
const SUBJECT = "trolley";
const STAND_IN = "hook";

const SITE = 0;

/** A move that keeps the run running and moves nothing (specs/rigging.md). */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The far end of the minimal crane's track, four units from its origin. */
const TROLLEY_AT = 4;

/** Where the carriage then stands, and where the bob is parked under it. */
const CARRIAGE: Vec3 = { x: 4, y: 4, z: 0 };
const BOB: Vec3 = { x: 4, y: 4 - HOIST_START, z: 0 };

/** How far around the carriage's point its drawing is held, in world units. */
const HALF = 2;

/** The box the carriage's drawing is held inside. */
const AT_CARRIAGE = new THREE.Box3(
  new THREE.Vector3(CARRIAGE.x - HALF, CARRIAGE.y - HALF, CARRIAGE.z - HALF),
  new THREE.Vector3(CARRIAGE.x + HALF, CARRIAGE.y + HALF, CARRIAGE.z + HALF),
);

/** Stand the minimal crane up and run the carriage out to the track's end. */
async function poseCarriage(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [HOLD]);
  await startRun(h);
  await h.debug.setAxis("trolley", TROLLEY_AT);
  await h.debug.setBob(BOB.x, BOB.y, BOB.z);
  await h.debug.setBobVelocity(0, 0, 0);
  await h.advance(1);
  const { run } = await h.snapshot();
  if (Math.abs(run.axes.trolley.value - TROLLEY_AT) > 1e-6) {
    fail(
      `the trolley axis to stand at ${TROLLEY_AT} along the track after it is ` +
        "posed there, which specs/instrumentation.md's `setAxis` establishes",
      `it reads ${run.axes.trolley.value}`,
    );
  }
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

it("draws the trolley at the trolley position on the track", async () => {
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

  await poseCarriage(served);
  const before = bodies(served);
  await served.capture("trolley", "The trolley at the trolley position");

  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await poseCarriage(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "trolley from it",
  );

  const parted = differing(before, after);
  assertGreaterThan(
    parted.length,
    0,
    "the trolley to be drawn from its produced model at all, so that what " +
      "follows is a reading of where the carriage is rather than of a build " +
      "drawing no carriage (specs/assets.md)",
  );

  const spilled = parted.filter((body) => !AT_CARRIAGE.containsBox(body.box));
  if (spilled.length > 0) {
    const one = spilled[0]!;
    fail(
      `the trolley drawn within ${HALF} units of the trolley point ` +
        `(${CARRIAGE.x}, ${CARRIAGE.y}, ${CARRIAGE.z}) the axis at ` +
        `${TROLLEY_AT} puts it at, so serving other bytes under ` +
        `assets/models/${SUBJECT}.glb changes nothing elsewhere in the yard ` +
        "(specs/assets.md, specs/rigging.md)",
      `${spilled.length} of the ${parted.length} bodies that differ reach ` +
        `outside it: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
