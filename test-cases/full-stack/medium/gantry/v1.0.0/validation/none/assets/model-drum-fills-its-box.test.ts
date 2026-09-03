// assets/model-drum-fills-its-box — the committed `drum` model spans the
// class box the game collides and places that load by.
//
// specs/assets.md § The models states the requirement and the reason in one
// sentence: "The three load models fill their class boxes: a load's collisions
// and placement use the class dimensions from `specs/world.md` whatever is
// drawn, so a model well short of its box would read as missing what it visibly
// overlaps." The same table sizes the `drum` model at "its class box,
// `2 x 3 x 2` units", and specs/world.md § Loads fixes that class box:
// "`drum` | `2 x 3 x 2`", read as width by height by depth at yaw `0`.
//
// THE MEASUREMENT IS OF THE COMMITTED FILE, because that is what the sentence is
// about. specs/assets.md commits each model as `assets/models/<model>.glb`,
// "under the model name the table below gives it", and says "the name a file
// carries is what says which subject or which cue it is" — so the file that draws
// the `drum` class is `assets/models/drum.glb`, and no search is needed
// to find it. It is sculpted "at `VOXELS_PER_UNIT` (`8`): eight voxels to one
// world unit, so the game draws every model at a scale of
// `1 / VOXELS_PER_UNIT`", which is what turns the mesh's own extent into the
// size it is drawn at.
//
// WHAT IS MEASURED is the axis-aligned extent of every mesh the file's scene
// draws, each primitive's `POSITION` accessor bounds carried out through the node
// transforms above it. glTF 2.0 requires `min` and `max` on a `POSITION`
// accessor, so the extent is read off the file's own declaration of it rather
// than off a decode of its vertices.
//
// THE TOLERANCE IS ONE-SIDED, because the requirement is. What specs/assets.md
// forbids is a model "well short of its box"; nothing there caps a model at its
// box. So each axis is required to reach 85% of the class dimension, and a
// model that overfills its box is a different complaint from this one.
//
// The still beside it is the load the class draws, posed alone in an emptied
// yard, so a reviewer sees the model this point measured.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, fail } from "../assert";
import { LOAD_CLASS_DIMENSIONS, VOXELS_PER_UNIT } from "../constants";
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

/** The class this point is about, and the model specs/assets.md names for it. */
const CLASS = "drum" as const;
const MODEL = "drum";

const SITE = 0;

/**
 * The share of each class dimension the model's extent has to reach.
 *
 * specs/assets.md gives no figure, only "well short"; this is the honest reading
 * of it. A voxel sculpt at eight voxels to the unit cannot always land on the
 * box's face — a round form inscribed in a two-unit box gives up a voxel at each
 * side, an eighth of a unit — so an axis has to be allowed to stop a little
 * inside. A model reaching seven eighths of the way across is filling its box;
 * one stopping short of that is the miss the sentence is about.
 */
const FILL = 0.85;

/** Where the load stands: out in the open yard, clear of the anchors. */
const AT: LoadPose = { x: 6, y: 3, z: 0, yaw: 0 };
const MASS = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("draws the drum class from a model that fills its class box", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await addOneLoad(h, CLASS, MASS, AT, AT);
  await h.advance(1);
  await h.capture("drum", "The drum model against its class box");

  const box = LOAD_CLASS_DIMENSIONS[CLASS];
  const drawn = drawnExtent();
  const axes = [
    { name: "x", span: drawn.x, box: box.x },
    { name: "y", span: drawn.y, box: box.y },
    { name: "z", span: drawn.z, box: box.z },
  ];
  for (const axis of axes) {
    assertGreaterThanOrEqual(
      axis.span,
      FILL * axis.box,
      `the ${axis.name} span of the committed assets/models/${MODEL}.glb, in ` +
        `world units, against the ${CLASS} class box's ${axis.box} — ` +
        "specs/assets.md asks that the three load models fill their class " +
        "boxes, since a load's collisions and placement use the class " +
        "dimensions whatever is drawn (the model measures " +
        `${drawn.x.toFixed(3)} x ${drawn.y.toFixed(3)} x ` +
        `${drawn.z.toFixed(3)} units)`,
    );
  }
});

/** The size the committed model is drawn at, in world units on each axis. */
function drawnExtent(): { x: number; y: number; z: number } {
  const size = meshExtent(committedModel());
  return {
    x: size[0] / VOXELS_PER_UNIT,
    y: size[1] / VOXELS_PER_UNIT,
    z: size[2] / VOXELS_PER_UNIT,
  };
}

/** The model specs/assets.md requires the build to have produced and committed. */
function committedModel(): Buffer {
  try {
    return readFileSync(join(WORKSPACE, "assets", "models", `${MODEL}.glb`));
  } catch {
    return fail(
      `a produced ${MODEL} model committed at assets/models/${MODEL}.glb, ` +
        "which specs/assets.md requires the build to produce with `voxel` and " +
        "commit under the name that says which subject it draws",
      "no such file in the build's tree",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Reading a glTF binary's extent                                             */
/* -------------------------------------------------------------------------- */
//
// Only the JSON chunk is read. A `POSITION` accessor carries `min` and `max` by
// the glTF 2.0 specification, so the extent of every mesh the scene draws is
// already declared in the file; what is left is to carry each mesh's box out
// through the node transforms above it and take the union.

/** A 4x4 column-major matrix, as glTF writes one. */
type Matrix = number[];

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** The axis-aligned size of everything the file's scene draws, in its own units. */
function meshExtent(file: Buffer): [number, number, number] {
  const gltf = glbJson(file);
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  const visit = (index: number, parent: Matrix): void => {
    const node = gltf.nodes?.[index];
    if (node === undefined) return;
    const world = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes?.[node.mesh]?.primitives ?? []) {
        const accessor = gltf.accessors?.[primitive.attributes?.POSITION ?? -1];
        if (accessor?.min === undefined || accessor.max === undefined) {
          fail(
            "every POSITION accessor of the committed " +
              `assets/models/${MODEL}.glb to declare its \`min\` and \`max\`, ` +
              "which the glTF 2.0 specification requires of one and which " +
              "`voxel`'s `render` writes",
            "a mesh primitive in the file declares neither",
          );
        }
        for (const dx of [0, 1]) {
          for (const dy of [0, 1]) {
            for (const dz of [0, 1]) {
              const corner: [number, number, number] = [
                (dx === 1 ? accessor.max : accessor.min)[0]!,
                (dy === 1 ? accessor.max : accessor.min)[1]!,
                (dz === 1 ? accessor.max : accessor.min)[2]!,
              ];
              const at = apply(world, corner);
              for (let axis = 0; axis < 3; axis += 1) {
                low[axis] = Math.min(low[axis]!, at[axis]!);
                high[axis] = Math.max(high[axis]!, at[axis]!);
              }
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  const scene = gltf.scenes?.[gltf.scene ?? 0];
  const roots = scene?.nodes ?? (gltf.nodes ?? []).map((_, index) => index);
  for (const root of roots) visit(root, IDENTITY);

  if (!Number.isFinite(low[0])) {
    fail(
      `the committed assets/models/${MODEL}.glb to carry the meshed model ` +
        "specs/assets.md has `voxel`'s `render` write",
      "the file's scene draws no mesh at all",
    );
  }
  return [high[0] - low[0], high[1] - low[1], high[2] - low[2]];
}

/** One glTF node, as much of it as an extent needs. */
interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

/** The glTF document a binary carries, as much of it as an extent needs. */
interface Gltf {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: { attributes?: { POSITION?: number } }[] }[];
  accessors?: { min?: number[]; max?: number[] }[];
}

/** The JSON chunk of a `.glb`, by the container's own layout. */
function glbJson(file: Buffer): Gltf {
  const GLB_MAGIC = 0x46546c67;
  const JSON_CHUNK = 0x4e4f534a;
  if (file.length < 12 || file.readUInt32LE(0) !== GLB_MAGIC) {
    fail(
      `the committed assets/models/${MODEL}.glb to be the glTF binary ` +
        "specs/assets.md has `voxel`'s `render` mesh the model to",
      "the file does not open with the glTF binary container's magic",
    );
  }
  for (let at = 12; at + 8 <= file.length; ) {
    const length = file.readUInt32LE(at);
    const kind = file.readUInt32LE(at + 4);
    if (kind === JSON_CHUNK) {
      return JSON.parse(
        file.subarray(at + 8, at + 8 + length).toString("utf8"),
      ) as Gltf;
    }
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  return fail(
    `the committed assets/models/${MODEL}.glb to carry the JSON chunk every ` +
      "glTF binary opens with",
    "the file carries no JSON chunk",
  );
}

/** A node's own transform, however glTF wrote it. */
function localMatrix(node: GltfNode): Matrix {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return node.matrix.slice();
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y! * y! + z! * z!)) * sx!,
    2 * (x! * y! + z! * w!) * sx!,
    2 * (x! * z! - y! * w!) * sx!,
    0,
    2 * (x! * y! - z! * w!) * sy!,
    (1 - 2 * (x! * x! + z! * z!)) * sy!,
    2 * (y! * z! + x! * w!) * sy!,
    0,
    2 * (x! * z! + y! * w!) * sz!,
    2 * (y! * z! - x! * w!) * sz!,
    (1 - 2 * (x! * x! + y! * y!)) * sz!,
    0,
    tx!,
    ty!,
    tz!,
    1,
  ];
}

/** `a` then `b`, in glTF's column-major order. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1)
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** A point through a matrix. */
function apply(
  m: Matrix,
  p: [number, number, number],
): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}
