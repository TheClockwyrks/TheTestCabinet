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
// `VOXELS_PER_UNIT` that is the extent the model must be drawn at, in world
// units — and where a box of that extent lands on the stage is the build's own
// answer, through `project` (specs/instrumentation.md). The drawn silhouette is
// then measured by photographing the yard with the load and without it and
// taking the extent of what changed.
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
// THE TOLERANCE. What a silhouette's extent can honestly be held to is the
// projected extent of the mesh's own bounding box, and the two are not the same
// measurement. A model with rounded or chamfered corners reaches its bounding
// box on each face but not at the corners, so its silhouette is smaller than the
// projected box; an outline, a contact shadow, or an antialiased boundary makes
// it larger — the reference build measures about a sixth over on one axis and on
// the nose on the other. Where the model's own origin sits inside the class box
// is the build's too, and a model shifted inside its box changes what the
// perspective does to its extent. So the bar is set at a third either way, which
// covers every one of those and is still nowhere near the eightfold error the
// requirement exists to catch — a model drawn at the mesh's own scale is eight
// times over, and one drawn to fit some other box is out by a factor rather than
// by a fraction.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertNear, assertTrue, fail } from "../assert";
import {
  LOAD_CLASS_DIMENSIONS,
  STAGE_W,
  VOXELS_PER_UNIT,
} from "../constants";
import { clearAll, createHarness, openSite, type Harness, type LoadPose } from "../harness";

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

/** How far around the class box the silhouette is looked for, as a share of it. */
const WINDOW_SHARE = 3;

/** How different two pixels must be to be part of the silhouette. */
const THRESHOLD = 24;

/** How far the measured extent may sit from the mesh's own, either way. */
const TOLERANCE_SHARE = 1 / 3;

/** Below this many changed pixels there is no silhouette to measure. */
const MIN_PIXELS = 200;

/** A rectangle of the stage, in logical units. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
  const [qx, qy, qz, qw] = (node.rotation as number[] | undefined) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (node.scale as number[] | undefined) ?? [1, 1, 1];
  const rotation = [
    1 - 2 * (qy! * qy! + qz! * qz!), 2 * (qx! * qy! + qz! * qw!), 2 * (qx! * qz! - qy! * qw!), 0,
    2 * (qx! * qy! - qz! * qw!), 1 - 2 * (qx! * qx! + qz! * qz!), 2 * (qy! * qz! + qx! * qw!), 0,
    2 * (qx! * qz! + qy! * qw!), 2 * (qy! * qz! - qx! * qw!), 1 - 2 * (qx! * qx! + qy! * qy!), 0,
    0, 0, 0, 1,
  ];
  const scale = [sx!, 0, 0, 0, 0, sy!, 0, 0, 0, 0, sz!, 0, 0, 0, 0, 1];
  const translation = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx!, ty!, tz!, 1];
  return times(translation, times(rotation, scale));
}

/** A point through a column-major 4x4. */
function apply(m: Matrix, p: readonly [number, number, number]): [number, number, number] {
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
    for (const primitive of ((mesh?.primitives ?? []) as Record<string, unknown>[])) {
      const attributes = primitive.attributes as Record<string, number> | undefined;
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
    for (const child of ((node.children ?? []) as number[])) walk(child, world);
  };
  for (const root of roots) walk(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

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
  const center = { x: pose.x, y: pose.y - size.y / 2, z: pose.z };

  await openSite(h, SITE);
  await clearAll(h);
  await h.debug.addLoad(CLASS, MASS, pose.x, pose.y, pose.z, pose.yaw);
  await h.debug.setLoadTarget(0, PAD.x, PAD.y + size.y, PAD.z, PAD.yaw);
  await h.advance(1);

  // Where a box of the sculpted extent, drawn at 1 / VOXELS_PER_UNIT, lands.
  const project = async (
    half: { x: number; y: number; z: number },
  ): Promise<Rect> => {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const dx of [-half.x, half.x]) {
      for (const dy of [-half.y, half.y]) {
        for (const dz of [-half.z, half.z]) {
          const at = await h.project(center.x + dx, center.y + dy, center.z + dz);
          assertTrue(
            at.visible,
            "every corner of the model's drawn extent to be on the stage at " +
              "the start camera pose, so this point has a silhouette to " +
              "measure (specs/instrumentation.md)",
          );
          left = Math.min(left, at.x);
          right = Math.max(right, at.x);
          top = Math.min(top, at.y);
          bottom = Math.max(bottom, at.y);
        }
      }
    }
    return { x: left, y: top, width: right - left, height: bottom - top };
  };

  const expected = await project({ x: drawn.x / 2, y: drawn.y / 2, z: drawn.z / 2 });
  const window = await project({
    x: (drawn.x / 2) * WINDOW_SHARE,
    y: (drawn.y / 2) * WINDOW_SHARE,
    z: (drawn.z / 2) * WINDOW_SHARE,
  });

  // The pad is drawn at the target, and it must not fall in the window this
  // point measures the silhouette in.
  const padAt = await h.project(PAD.x, PAD.y, PAD.z);
  assertTrue(
    padAt.x < window.x ||
      padAt.x > window.x + window.width ||
      padAt.y < window.y ||
      padAt.y > window.y + window.height,
    "the load's pad to be drawn outside the window this point measures the " +
      "model's silhouette in, so the class outline never stands in for the " +
      "model's own extent",
  );

  const withLoad = (await h.page.screenshot()).toString("base64");
  await h.debug.clearLoads();
  await h.advance(1);
  const without = (await h.page.screenshot()).toString("base64");

  const measured = (await h.page.evaluate(
    async ([a, b, box, limit, stageWidth]) => {
      const read = async (encoded: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(encoded), (one) => one.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d")!;
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const one = await read(a as string);
      const two = await read(b as string);
      const rect = box as { x: number; y: number; width: number; height: number };
      const scale = one.width / (stageWidth as number);
      const x0 = Math.max(0, Math.floor(rect.x * scale));
      const x1 = Math.min(one.width - 1, Math.ceil((rect.x + rect.width) * scale));
      const y0 = Math.max(0, Math.floor(rect.y * scale));
      const y1 = Math.min(one.height - 1, Math.ceil((rect.y + rect.height) * scale));
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      let count = 0;
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const at = (y * one.width + x) * 4;
          const delta =
            Math.abs(one.data[at]! - two.data[at]!) +
            Math.abs(one.data[at + 1]! - two.data[at + 1]!) +
            Math.abs(one.data[at + 2]! - two.data[at + 2]!);
          if (delta <= (limit as number)) continue;
          count += 1;
          left = Math.min(left, x / scale);
          right = Math.max(right, x / scale);
          top = Math.min(top, y / scale);
          bottom = Math.max(bottom, y / scale);
        }
      }
      return { count, width: right - left, height: bottom - top };
    },
    [withLoad, without, window, THRESHOLD, STAGE_W] as const,
  )) as { count: number; width: number; height: number };

  assertTrue(
    measured.count >= MIN_PIXELS,
    `a silhouette to measure where the ${CLASS} stands: at least ` +
      `${MIN_PIXELS} pixels of the window change when the load is taken away, ` +
      `and ${measured.count} did`,
  );

  const context =
    `the ${CLASS}'s drawn width on the stage, for a mesh ` +
    `${sculpted.x} x ${sculpted.y} x ${sculpted.z} in the file drawn at ` +
    `1 / ${VOXELS_PER_UNIT} (specs/assets.md)`;
  assertNear(
    measured.width,
    expected.width,
    TOLERANCE_SHARE * expected.width,
    context,
  );
  assertNear(
    measured.height,
    expected.height,
    TOLERANCE_SHARE * expected.height,
    `the ${CLASS}'s drawn height on the stage, for the same mesh at the same ` +
      "scale (specs/assets.md)",
  );

  console.log(
    `gantry: the drawn silhouette measured against the decoded mesh — ` +
      `mesh ${sculpted.x} x ${sculpted.y} x ${sculpted.z} voxels, drawn ` +
      `${drawn.x} x ${drawn.y} x ${drawn.z} units, expected ` +
      `${expected.width.toFixed(1)} x ${expected.height.toFixed(1)} stage ` +
      `pixels, measured ${measured.width.toFixed(1)} x ` +
      `${measured.height.toFixed(1)}`,
  );

  // The evidence is the frame the silhouette was measured in, so the load goes
  // back where it stood.
  await h.debug.addLoad(CLASS, MASS, pose.x, pose.y, pose.z, pose.yaw);
  await h.debug.setLoadTarget(0, PAD.x, PAD.y + size.y, PAD.z, PAD.yaw);
  await h.advance(1);
  await h.capture("scale", "The drawn silhouette measured against the decoded mesh");
});
