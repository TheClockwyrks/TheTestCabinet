// assets/models-drawn-at-voxel-scale — a model is drawn at a scale of
// 1 / VOXELS_PER_UNIT of the mesh it was sculpted as.
//
// specs/assets.md, "The models": "Sculpt each model with `voxel` at
// `VOXELS_PER_UNIT` (`8`): eight voxels to one world unit, so the game draws
// every model at a scale of `1 / VOXELS_PER_UNIT`."
//
// WHY THAT IS A REQUIREMENT AT ALL. A `.glb` out of `voxel` is in VOXELS, so a
// mesh of a crate is sixteen units across rather than two. A build that dropped
// the model into the scene at the mesh's own scale would draw a crate eight
// times the size of the box it collides and places by, and one that scaled it to
// fit the class box would draw a model sculpted small at a size it was never
// sculpted for. The figure is exact and the specification states it, so it can be
// read exactly.
//
// THE READING. The committed `.glb` is decoded off disk far enough to measure
// the mesh: glTF requires a `POSITION` accessor to carry its own `min` and
// `max`, and the node transforms above it are applied, so the mesh's extent in
// voxels is read from the file rather than inferred. Divided by
// `VOXELS_PER_UNIT` that is the extent the model must be drawn at, IN WORLD
// UNITS — and under this engine that is exactly where the drawing can be
// measured: the yard is the engine's own retained scene, "live and retained…
// what lets a check find an object and read its world position with no pixels
// involved" (`rendering.ts`), and this process has no GPU to make pixels with. So
// the drawn extent is the world extent of what the yard gains when the load is
// posed, read against the file's own figure in the same units. An engineless
// build's version of this point has to project a box of that extent and measure a
// silhouette against it; here the two are the same measurement and no camera
// comes into it.
//
// ONE MODEL, POSED ALONE. The crate is the model a validator can put in an
// otherwise empty yard by itself, at a pose of its own choosing, with nothing
// else drawn near it — the parts are drawn where the structure is and cannot be
// separated from it. The scale is one rule over all eight models, so reading it
// on the one that can be isolated is reading the rule.
//
// THE PAD IS PUT OUT OF THE WAY. A load's pad is drawn at its target pose and is
// the class outline, not the model, so a pad under the load would set a floor on
// the measured extent and hide a model drawn too small. The target is therefore
// moved well away, and the measurement window is checked to exclude it.
//
// THE TOLERANCE. The mesh's own bounding box and what a build puts in the scene
// for it are not quite the same body: a build may wrap the model in a group with
// a shadow, a marker or a rim of its own, which reads a little large, and a
// bounding box computed from a file's declared accessor bounds can sit a little
// wide of the triangles inside it. A tenth either way covers that and is nowhere
// near the eightfold error the requirement exists to catch — a model drawn at the
// mesh's own scale is eight times over, and one drawn to fit some other box is
// out by a factor rather than by a fraction.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import * as THREE from "three";
import { assertNear, assertTrue, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS, VOXELS_PER_UNIT } from "../constants";
import {
  createHarness,
  openSite,
  type Harness,
  type LoadPose,
} from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The model this point measures, and where `specs/assets.md` commits it. */
const CLASS = "crate" as const;
const MODEL = join(WORKSPACE, "assets", "models", `${CLASS}.glb`);

const SITE = 0;
const MASS = 40;

/** Where the load stands, and where its pad is put so it is out of the frame. */
const POSE: LoadPose = { x: 7, y: 0, z: -3, yaw: 0 };
const PAD: LoadPose = { x: -6, y: 0, z: 8, yaw: 0 };

/** How far the measured extent may sit from the mesh's own, either way. */
const TOLERANCE_SHARE = 0.1;

/* -------------------------------------------------------------------------- */
/* The committed mesh                                                         */
/* -------------------------------------------------------------------------- */

type Matrix = number[];

/** Column-major 4x4 multiply, in glTF's own convention. */
function times(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** A node's own transform: its `matrix`, or the TRS glTF composes as T * R * S. */
function transformOf(node: Record<string, unknown>): Matrix {
  const given = node.matrix as number[] | undefined;
  if (Array.isArray(given) && given.length === 16) return given;
  const [tx, ty, tz] = (node.translation as number[] | undefined) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = (node.rotation as number[] | undefined) ?? [
    0, 0, 0, 1,
  ];
  const [sx, sy, sz] = (node.scale as number[] | undefined) ?? [1, 1, 1];
  const rotation = [
    1 - 2 * (qy! * qy! + qz! * qz!),
    2 * (qx! * qy! + qz! * qw!),
    2 * (qx! * qz! - qy! * qw!),
    0,
    2 * (qx! * qy! - qz! * qw!),
    1 - 2 * (qx! * qx! + qz! * qz!),
    2 * (qy! * qz! + qx! * qw!),
    0,
    2 * (qx! * qz! + qy! * qw!),
    2 * (qy! * qz! - qx! * qw!),
    1 - 2 * (qx! * qx! + qy! * qy!),
    0,
    0,
    0,
    0,
    1,
  ];
  const scale = [sx!, 0, 0, 0, 0, sy!, 0, 0, 0, 0, sz!, 0, 0, 0, 0, 1];
  const translation = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx!, ty!, tz!, 1];
  return times(translation, times(rotation, scale));
}

/** A point through a column-major 4x4. */
function apply(
  m: Matrix,
  p: readonly [number, number, number],
): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

/**
 * The extent of a committed `.glb`'s mesh, in the units the file carries.
 *
 * Only the glTF JSON chunk is read: a `POSITION` accessor is required to carry
 * its own `min` and `max`, so the mesh's bounding box is in the file and the
 * binary buffer never has to be decoded. Each node's transform is applied, so an
 * exporter that put the mesh under a transform is measured as it is drawn.
 */
function meshExtent(path: string): { x: number; y: number; z: number } {
  const bytes = readFileSync(path);
  if (
    bytes.length < 20 ||
    bytes.toString("latin1", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2
  ) {
    fail(
      `\`assets/models/${CLASS}.glb\` to be the glTF 2.0 binary \`voxel\` ` +
        "writes (specs/assets.md)",
      bytes.length < 20
        ? `${bytes.length} bytes`
        : `a "${bytes.toString("latin1", 0, 4)}" file of version ` +
            `${bytes.readUInt32LE(4)}`,
    );
  }
  const chunkLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4e4f534a) {
    fail(
      `\`assets/models/${CLASS}.glb\`'s first chunk to be the glTF JSON chunk`,
      `chunk type 0x${bytes.readUInt32LE(16).toString(16)}`,
    );
  }
  const gltf = JSON.parse(
    bytes.toString("utf8", 20, 20 + chunkLength),
  ) as Record<string, unknown>;

  const nodes = (gltf.nodes ?? []) as Record<string, unknown>[];
  const meshes = (gltf.meshes ?? []) as Record<string, unknown>[];
  const accessors = (gltf.accessors ?? []) as Record<string, unknown>[];
  const scenes = (gltf.scenes ?? []) as { nodes?: number[] }[];
  const roots =
    scenes[(gltf.scene as number | undefined) ?? 0]?.nodes ??
    nodes.map((_, index) => index);

  const lowest: [number, number, number] = [Infinity, Infinity, Infinity];
  const highest: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const walk = (index: number, parent: Matrix): void => {
    const node = nodes[index];
    if (node === undefined) return;
    const world = times(parent, transformOf(node));
    const mesh = meshes[(node.mesh as number | undefined) ?? -1];
    for (const primitive of (mesh?.primitives ?? []) as Record<
      string,
      unknown
    >[]) {
      const attributes = primitive.attributes as
        | Record<string, number>
        | undefined;
      const accessor = accessors[attributes?.POSITION ?? -1];
      const min = accessor?.min as number[] | undefined;
      const max = accessor?.max as number[] | undefined;
      if (min === undefined || max === undefined) {
        fail(
          `\`assets/models/${CLASS}.glb\` to carry the \`min\` and \`max\` a ` +
            "glTF `POSITION` accessor is required to declare, so its sculpted " +
            "extent can be read",
          "an accessor declaring neither",
        );
      }
      for (const x of [min[0]!, max[0]!]) {
        for (const y of [min[1]!, max[1]!]) {
          for (const z of [min[2]!, max[2]!]) {
            const at = apply(world, [x, y, z]);
            for (let axis = 0; axis < 3; axis += 1) {
              lowest[axis] = Math.min(lowest[axis]!, at[axis]!);
              highest[axis] = Math.max(highest[axis]!, at[axis]!);
            }
          }
        }
      }
    }
    for (const child of (node.children ?? []) as number[]) walk(child, world);
  };
  for (const root of roots)
    walk(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  if (!Number.isFinite(lowest[0]) || !Number.isFinite(highest[0])) {
    fail(
      `\`assets/models/${CLASS}.glb\` to carry a mesh, since the game draws ` +
        `the ${CLASS} from it (specs/assets.md)`,
      "no mesh reachable from its scene",
    );
  }
  return {
    x: highest[0]! - lowest[0]!,
    y: highest[1]! - lowest[1]!,
    z: highest[2]! - lowest[2]!,
  };
}

/* -------------------------------------------------------------------------- */

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One body the yard shows, and its world extent. */
interface Body {
  signature: string;
  box: THREE.Box3;
}

/** Every body the yard SHOWS, with its world extent. */
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
    found.push({
      signature: [
        object.type,
        box.min
          .toArray()
          .map((one) => one.toFixed(4))
          .join(),
        box.max
          .toArray()
          .map((one) => one.toFixed(4))
          .join(),
      ].join("|"),
      box,
    });
  });
  return found;
}

it("draws a model at 1 / VOXELS_PER_UNIT of its sculpted extent", async () => {
  const sculpted = meshExtent(MODEL);
  const drawn = {
    x: sculpted.x / VOXELS_PER_UNIT,
    y: sculpted.y / VOXELS_PER_UNIT,
    z: sculpted.z / VOXELS_PER_UNIT,
  };

  const size = LOAD_CLASS_DIMENSIONS[CLASS];
  const pose: LoadPose = { ...POSE, y: POSE.y + size.y };
  // The center of the class box the load occupies (specs/world.md), which is
  // where a model that fills that box is drawn.
  const center = new THREE.Vector3(pose.x, pose.y - size.y / 2, pose.z);

  await openSite(h, SITE);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await h.advance(1);
  const bare = bodies(h);

  // The pad is drawn at the target, and it is the class outline rather than the
  // model, so it is put well away from where the load stands.
  await h.debug.addLoad(CLASS, MASS, pose.x, pose.y, pose.z, pose.yaw);
  await h.debug.setLoadTarget(0, PAD.x, PAD.y + size.y, PAD.z, PAD.yaw);
  await h.advance(1);
  await h.capture("scale", "The drawn model measured against the decoded mesh");

  const was = new Set(bare.map((body) => body.signature));
  // Everything the yard gained, near where the load stands: the model's own
  // body. The pad is at `PAD`, a dozen units away, so nothing of it is here.
  const added = bodies(h).filter(
    (body) =>
      !was.has(body.signature) &&
      body.box.getCenter(new THREE.Vector3()).distanceTo(center) <=
        Math.max(size.x, size.y, size.z),
  );
  assertTrue(
    added.length > 0,
    `a body drawn where the ${CLASS} stands when it is posed, which is what ` +
      "this point measures against the committed mesh (specs/assets.md)",
  );

  const extent = new THREE.Box3();
  for (const body of added) extent.union(body.box);
  const measured = extent.getSize(new THREE.Vector3());

  for (const axis of ["x", "y", "z"] as const) {
    assertNear(
      measured[axis],
      drawn[axis],
      TOLERANCE_SHARE * drawn[axis],
      `the ${CLASS}'s drawn extent along ${axis}, in world units, for a mesh ` +
        `${sculpted.x} x ${sculpted.y} x ${sculpted.z} in the file drawn at ` +
        `1 / ${VOXELS_PER_UNIT} (specs/assets.md)`,
    );
  }

  console.log(
    `gantry: the drawn model measured against the decoded mesh — mesh ` +
      `${sculpted.x} x ${sculpted.y} x ${sculpted.z} voxels, expected ` +
      `${drawn.x} x ${drawn.y} x ${drawn.z} units, measured ` +
      `${measured.x.toFixed(3)} x ${measured.y.toFixed(3)} x ` +
      `${measured.z.toFixed(3)}`,
  );
});
