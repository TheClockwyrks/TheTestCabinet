// assets/mount-model-at-each-anchor — a mount is drawn at each anchor, and at no
// other lattice node.
//
// specs/assets.md § The models: "The game draws each model wherever its subject
// is: … a mount at each anchor …". specs/world.md § Anchors gives the anchors as
// "lattice nodes on the ground where the structure is fixed to the earth", and
// specs/sites.md fixes them site by site.
//
// SITE SIX IS THE ONE READ, because its nine anchors over `(0..4, 0, 0..4)` are
// the largest set the game has, so the point is decided over nine independent
// fixtures rather than four. The four ground nodes read beside them are on the
// same site's lattice, on the ground and inside its envelope, and are not
// anchors: a build that drew a fixture on every ground node fails there.
//
// THE TOLERANCE IS A BOX AROUND EACH NODE. specs/assets.md sizes the mount "about
// `1.5 x 0.75 x 1.5` units", so a box reaching `0.9` each way horizontally holds
// a fixture of that intent while staying inside the two-unit pitch between one
// anchor and the next, and the vertical span covers a fixture standing on the
// ground and the stand-in drawn in its place.

// WHERE THE MODEL IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE,
// not by placing the subject and looking at what changed. Placing anything in the
// yard legitimately redraws parts of the picture that have nothing to do with
// where the model goes — a cost readout, a member's colour. Two harnesses stand
// the same build up, posed identically and answered the same in every respect but
// the bytes under `assets/models/mount.glb`; what differs between them is
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
const SUBJECT = "mount";
const STAND_IN = "hook";

/** Heavy Haul, `specs/sites.md`'s sixth site, counted from `0`. */
const SITE = 5;

/** The nine anchors specs/sites.md § Site 6 fixes. */
const ANCHORS: readonly Vec3[] = [
  { x: 0, y: 0, z: 0 },
  { x: 2, y: 0, z: 0 },
  { x: 4, y: 0, z: 0 },
  { x: 0, y: 0, z: 2 },
  { x: 2, y: 0, z: 2 },
  { x: 4, y: 0, z: 2 },
  { x: 0, y: 0, z: 4 },
  { x: 2, y: 0, z: 4 },
  { x: 4, y: 0, z: 4 },
];

/** How far around a node its fixture's drawing is read, in world units. */
const HALF = 0.9;
const Y_LOW = -0.5;
const Y_HIGH = 1.5;

/** The box a fixture standing on `node` is held inside. */
function around(node: Vec3): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(node.x - HALF, Y_LOW, node.z - HALF),
    new THREE.Vector3(node.x + HALF, Y_HIGH, node.z + HALF),
  );
}

/** An emptied site, with nothing built, so a fixture is all that stands. */
async function bareSite(h: Harness): Promise<void> {
  await openSite(h, SITE);
  await clearAll(h);
  await h.advance(1);
  const { site, structure } = await h.snapshot();
  if (structure.members.length !== 0 || structure.ring !== null) {
    fail(
      "an empty structure, so the only thing standing at an anchor is its " +
        "mount (specs/instrumentation.md's `clearStructure`)",
      `${structure.members.length} members and ` +
        `${structure.ring === null ? "no" : "a"} ring stand`,
    );
  }
  if (site.anchors.length !== ANCHORS.length) {
    fail(
      `the ${ANCHORS.length} anchors specs/sites.md gives ${site.name}`,
      `it carries ${site.anchors.length}`,
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

it("draws a mount at each of the site's anchors and at no other node", async () => {
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

  await bareSite(served);
  const before = bodies(served);
  await served.capture("anchors", "A mount at each of the site's anchors");

  substituted = await createHarness({
    substituteAssets: [{ from: subject, to: standIn }],
  });
  await bareSite(substituted);
  const after = bodies(substituted);

  assertGreaterThan(
    substituted.substitutedAssets(),
    0,
    "the responses the build was answered with the bytes of the committed " +
      `assets/models/${SUBJECT}.glb, which specs/assets.md has the build ` +
      "commit and wire in — a build that never asks for that file draws no " +
      "mount from it",
  );

  const parted = differing(before, after);
  for (const anchor of ANCHORS) {
    const box = around(anchor);
    assertGreaterThan(
      parted.filter((body) => box.containsBox(body.box)).length,
      0,
      `a mount drawn from its produced model at the anchor (${anchor.x}, ` +
        `${anchor.y}, ${anchor.z}), since the game draws one at each anchor ` +
        "(specs/assets.md § The models)",
    );
  }

  const spilled = parted.filter(
    (body) => !ANCHORS.some((anchor) => around(anchor).containsBox(body.box)),
  );
  if (spilled.length > 0) {
    const one = spilled[0]!;
    fail(
      `the mounts drawn within ${HALF} units of the anchors they stand on and ` +
        "nowhere else, since the game draws a mount at each anchor " +
        "(specs/assets.md § The models, specs/world.md § Anchors)",
      `${spilled.length} of the ${parted.length} bodies that differ stand ` +
        `elsewhere: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
