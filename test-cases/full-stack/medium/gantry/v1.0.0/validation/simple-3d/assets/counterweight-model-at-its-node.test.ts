// assets/counterweight-model-at-its-node — a counterweight is drawn at the node
// it hangs on, and at each of them.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … a counterweight at each carrying node …". specs/structure.md fixes what a
// carrying node is: a counterweight "is placed on a node the structure already
// uses" and "a node carries at most one".
//
// TWO NODES, EIGHT UNITS APART, BECAUSE ONE WOULD NOT SAY THE BLOCK FOLLOWS THE
// NODE. A build that drew one block at a fixed place — the ring, the origin —
// answers a single-node reading and fails here, and a build that drew one block
// for two counterweights fails the second box.
//
// THE TOLERANCE IS A BOX AROUND EACH NODE, two units each way: room for any block
// a build sculpts to the `1.5 x 1.5 x 1.5` units specs/assets.md gives as the
// intent, and for the stand-in drawn in its place, while leaving the other node
// four units outside.

// WHERE THE MODEL IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE,
// not by placing the subject and looking at what changed. Placing anything in the
// yard legitimately redraws parts of the picture that have nothing to do with
// where the model goes — a cost readout, a member's colour. Two harnesses stand
// the same build up, posed identically and answered the same in every respect but
// the bytes under `assets/models/counterweight.glb`; what differs between them is
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

/** The two struts, and the two nodes their upper ends carry a block on. */
const STRUTS: readonly { foot: Vec3; node: Vec3 }[] = [
  { foot: { x: 0, y: 0, z: 0 }, node: { x: 0, y: 2, z: 0 } },
  { foot: { x: 8, y: 0, z: 0 }, node: { x: 8, y: 2, z: 0 } },
];

/** How far around a node its block's drawing is held, in world units. */
const HALF = 2;

/** Two struts, and a counterweight on the node at the top of each. */
async function poseBlocks(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  for (const { foot, node } of STRUTS) {
    await h.debug.addMember(
      foot.x,
      foot.y,
      foot.z,
      node.x,
      node.y,
      node.z,
      "strut",
    );
    await h.debug.addCounterweight(node.x, node.y, node.z);
  }
  await h.advance(1);
  const { structure } = await h.snapshot();
  if (structure.counterweights.length !== STRUTS.length) {
    fail(
      `${STRUTS.length} counterweights standing, one on each node the ` +
        "structure uses, which specs/structure.md accepts",
      `${structure.counterweights.length} stand`,
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

it("draws a counterweight at each of the two carrying nodes", async () => {
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

  await poseBlocks(served);
  const before = bodies(served);
  await served.capture("counterweights", "A counterweight at each node");

  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await poseBlocks(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "counterweight from it",
  );

  const parted = differing(before, after);
  const boxes = STRUTS.map(({ node }) => ({
    node,
    box: new THREE.Box3(
      new THREE.Vector3(node.x - HALF, node.y - HALF, node.z - HALF),
      new THREE.Vector3(node.x + HALF, node.y + HALF, node.z + HALF),
    ),
  }));

  for (const { node, box } of boxes) {
    assertGreaterThan(
      parted.filter((body) => box.containsBox(body.box)).length,
      0,
      `a counterweight drawn from its produced model at the carrying node ` +
        `(${node.x}, ${node.y}, ${node.z}), since the game draws one at each ` +
        "carrying node (specs/assets.md § The models)",
    );
  }

  const spilled = parted.filter(
    (body) => !boxes.some(({ box }) => box.containsBox(body.box)),
  );
  if (spilled.length > 0) {
    const one = spilled[0]!;
    fail(
      `the counterweights drawn within ${HALF} units of the nodes they hang ` +
        `on, so serving other bytes under assets/models/${SUBJECT}.glb ` +
        "changes nothing elsewhere in the yard (specs/assets.md, " +
        "specs/structure.md)",
      `${spilled.length} of the ${parted.length} bodies that differ reach ` +
        `outside them: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
