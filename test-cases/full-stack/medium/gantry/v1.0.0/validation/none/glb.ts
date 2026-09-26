// Measuring a committed model file, for the checks that ask what a build
// actually produced.
//
// A FILE READ, NEVER A FRAME READ. What is measured here is the `.glb` the build
// committed — the artifact `specs/assets.md` asks for — and not anything on
// screen. What the build DRAWS is reported by `drawn()` and read from there; this
// is the other half of the comparison, and it is the half that lives on disk.

import { readFileSync } from "node:fs";
import { fail } from "./assert";

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
export function meshExtent(
  path: string,
  name: string,
): { x: number; y: number; z: number } {
  const bytes = readFileSync(path);
  if (
    bytes.length < 20 ||
    bytes.toString("latin1", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2
  ) {
    fail(
      `\`assets/models/${name}.glb\` to be the glTF 2.0 binary \`voxel\` ` +
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
      `\`assets/models/${name}.glb\`'s first chunk to be the glTF JSON chunk`,
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
          `\`assets/models/${name}.glb\` to carry the \`min\` and \`max\` a ` +
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
      `\`assets/models/${name}.glb\` to carry a mesh, since the game draws ` +
        `the ${name} from it (specs/assets.md)`,
      "no mesh reachable from its scene",
    );
  }
  return {
    x: highest[0]! - lowest[0]!,
    y: highest[1]! - lowest[1]!,
    z: highest[2]! - lowest[2]!,
  };
}
