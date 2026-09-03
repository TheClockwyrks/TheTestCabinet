// assets/ring-model-on-the-slew-axis — the ring is drawn on the slew axis, and
// between its own two flanges.
//
// specs/assets.md § The models says where the model goes: "The game draws each
// model wherever its subject is: the ring centered on the slew axis between its
// flanges …". specs/structure.md fixes both terms. The ring "is placed by its
// base corner, a lattice node `(x, y, z)`, and occupies eight nodes: the bottom
// flange, the four nodes … and the top flange, the same four nodes at
// `y + LATTICE_PITCH`", and "the slew axis is the vertical line through the
// flange square's center, `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)`".
// So the model belongs in the column of yard over the flange square, between
// `y` and `y + LATTICE_PITCH`, and nowhere else.
//
// THE TOLERANCE IS A BOX, AND THESE ARE ITS SIDES. specs/assets.md sizes the ring
// "about `2.5 x 2 x 2.5` units" and adds that the part figures "are the intent,
// not a tolerance", so the column is allowed to be wider than the intent: it
// reaches `1.75` from the axis, where a ring of the stated size reaches `1.25`,
// and a third of a unit past each flange, where a ring of the stated height
// reaches neither. What that leaves no room for is a ring hung off the axis or
// standing above or below its flanges, which is what the sentence is about.
//
// THE WORLD IS THE RING ALONE: no members, no loads, no obstacles, no tape, so
// nothing else in the yard can account for a difference outside the column.

// WHERE THE MODEL IS DRAWN IS READ BY SERVING A DIFFERENT MODEL UNDER ITS FILE,
// not by placing the subject and looking at what changed. Placing anything in the
// yard legitimately redraws parts of the picture that have nothing to do with
// where the model goes — a cost readout, a member's colour. Two harnesses stand
// the same build up, posed identically and answered the same in every respect but
// the bytes under `assets/models/ring.glb`; what differs between them is
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

/** The slew axis, and the two flange levels (specs/structure.md). */
const AXIS = {
  x: CORNER.x + LATTICE_PITCH / 2,
  z: CORNER.z + LATTICE_PITCH / 2,
};
const BOTTOM_FLANGE = CORNER.y;
const TOP_FLANGE = CORNER.y + LATTICE_PITCH;

/** How far from the slew axis, and past each flange, the ring may reach. */
const RADIUS = 1.75;
const OVERHANG = 0.35;

/** The column of yard the ring's drawing is held inside. */
const COLUMN = new THREE.Box3(
  new THREE.Vector3(AXIS.x - RADIUS, BOTTOM_FLANGE - OVERHANG, AXIS.z - RADIUS),
  new THREE.Vector3(AXIS.x + RADIUS, TOP_FLANGE + OVERHANG, AXIS.z + RADIUS),
);

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

it("draws the ring inside the column over the flange square, between the flanges", async () => {
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

  await poseRing(served);
  const before = bodies(served);
  await served.capture("ring", "The ring on the slew axis, between its flanges");

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

  const parted = differing(before, after);
  assertGreaterThan(
    parted.length,
    0,
    "the ring to be drawn from its produced model at all, so that what " +
      "follows is a reading of where the ring is rather than of a build " +
      "drawing no ring (specs/assets.md)",
  );

  const spilled = parted.filter((body) => !COLUMN.containsBox(body.box));
  if (spilled.length > 0) {
    const one = spilled[0]!;
    fail(
      `the ring drawn inside ${RADIUS} units of the slew axis at ` +
        `(${AXIS.x}, ${AXIS.z}) and between the ${BOTTOM_FLANGE} and ` +
        `${TOP_FLANGE} flange levels, so serving other bytes under ` +
        `assets/models/${SUBJECT}.glb changes nothing outside that column ` +
        "(specs/assets.md, specs/structure.md)",
      `${spilled.length} of the ${parted.length} bodies that differ reach ` +
        `outside it: one spans (${one.box.min.toArray().map((v) => v.toFixed(2)).join(", ")}) ` +
        `to (${one.box.max.toArray().map((v) => v.toFixed(2)).join(", ")})`,
    );
  }
});
