#!/usr/bin/env node
// Convert a produced voxel model into a glTF/GLB mesh — the offline counterpart of
// the `@test-cabinet/voxel-runtime` runtime, for embedding a voxel asset in an
// end-to-end game (or any engine) as a standard, animated mesh.
//
// It reads the artifacts a voxel-animation run produces — `rig.json` (the part
// hierarchy + joints) and per-part `voxels.json` (the regenerated voxel data) —
// and emits a glTF 2.0 file with:
//   • one mesh per part (interior faces culled, `#rrggbb` baked as vertex colors),
//   • a node hierarchy matching the part tree (a game can find a part by node name
//     and drive its transform, exactly as `voxel-runtime`'s `VoxelRig` does), and
//   • one glTF animation per case-authored animation and one for the rig's own
//     auto-play clips, so the motion plays in any glTF viewer/engine.
//
// A static model (`voxel-model`) has no rig — pass a single `voxels.json` and it
// emits a one-mesh, un-rigged glTF.
//
// This is a STANDALONE tool: it has no dependencies and can be copied out of the
// repo. Its mesh-culling and rig-posing math mirror the tested implementations in
// `packages/voxel-runtime/src/{mesh,hierarchy,clips}.ts` — keep them in sync.
//
// Usage:
//   node scripts/voxel-to-gltf.mjs --rig rig.json --voxels voxels/ --out model.glb
//   node scripts/voxel-to-gltf.mjs --rig rig.json --voxels voxels/ --out model.glb \
//        --animations model.animations.json
//   node scripts/voxel-to-gltf.mjs --voxels voxels.json --out model.glb   # static
//
// Flags:
//   --rig <path>          rig.json (omit for a static single-mesh model)
//   --voxels <path>       a directory of `<part>.json` files (rigged), or a single
//                         voxels.json file (static). Default: `voxels/` beside --rig.
//   --out <path>          output; `.glb` (binary, default) or `.gltf` (+ .bin)
//   --animations <path>   JSON with the case's animations: an array of AnimationSpec,
//                         or an object carrying `animations` / `rig.animations` /
//                         `model.animations`. Auto-play clips come from rig.json and
//                         need no flag.
//   --name <str>          model name (default: derived from --out)

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// CLI parsing

function parseArgs(argv) {
  const args = { out: null, rig: null, voxels: null, animations: null, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      const v = argv[++i];
      if (v === undefined) fail(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--rig": args.rig = take(); break;
      case "--voxels": args.voxels = take(); break;
      case "--out": args.out = take(); break;
      case "--animations": args.animations = take(); break;
      case "--name": args.name = take(); break;
      case "-h": case "--help": printHelp(); process.exit(0); break;
      default: fail(`unknown argument \`${a}\``);
    }
  }
  if (!args.out) fail("--out is required");
  if (!args.rig && !args.voxels) fail("pass --rig (rigged) or --voxels (static)");
  return args;
}

function printHelp() {
  // The header comment is the reference; print a short synopsis.
  process.stdout.write(
    "voxel-to-gltf — convert a produced voxel model to glTF/GLB\n\n" +
      "  node scripts/voxel-to-gltf.mjs --rig rig.json --voxels voxels/ --out model.glb\n" +
      "  node scripts/voxel-to-gltf.mjs --voxels voxels.json --out model.glb   # static\n\n" +
      "See the header of this file for every flag.\n",
  );
}

function fail(message) {
  process.stderr.write(`voxel-to-gltf: ${message}\n`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    fail(`could not read ${path}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mesh building — mirrors packages/voxel-runtime/src/mesh.ts

// Unit-cube faces, CCW from outside so back-face culling keeps the outward faces.
const FACES = [
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
];

function hexToRgb(hex) {
  const h = hex.charCodeAt(0) === 35 ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  if (h.length === 6 && !Number.isNaN(n)) {
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
  }
  return [1, 1, 1];
}

const cellKey = (x, y, z) => ((x + 1024) * 4096 + (y + 1024)) * 4096 + (z + 1024);

// Build a culled, vertex-colored surface mesh (plain arrays) from a VoxelsFile.
function buildPartMesh(voxels) {
  const occupied = new Set();
  for (const v of voxels.voxels) occupied.add(cellKey(v.x, v.y, v.z));
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let base = 0;
  for (const v of voxels.voxels) {
    const [r, g, b] = hexToRgb(v.color);
    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      if (occupied.has(cellKey(v.x + dx, v.y + dy, v.z + dz))) continue;
      for (const c of face.corners) {
        positions.push(v.x + c[0], v.y + c[1], v.z + c[2]);
        normals.push(dx, dy, dz);
        colors.push(r, g, b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    }
  }
  return { positions, normals, colors, indices };
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix math (column-major 4x4) — mirrors hierarchy.ts

const AXIS_INDEX = { x: 0, y: 1, z: 2 };

function identity() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function multiply(a, b) {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}

function translation(t) {
  const m = identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}

// Keep in sync with `rotation` in packages/voxel-runtime/src/hierarchy.ts: x
// (pitch) is negated relative to a right-handed rotation so a positive pitch
// lifts a forward (+z) part up toward +y; y (yaw) and z (roll) are right-handed.
function rotation(axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const m = identity();
  if (axis === "x") { m[5] = c; m[6] = -s; m[9] = s; m[10] = c; }
  else if (axis === "y") { m[0] = c; m[2] = -s; m[8] = s; m[10] = c; }
  else { m[0] = c; m[1] = s; m[4] = -s; m[5] = c; }
  return m;
}

// Intrinsic Euler [x,y,z] applied X→Y→Z, as Rz·Ry·Rx.
function eulerRotation(e) {
  return multiply(rotation("z", e[2]), multiply(rotation("y", e[1]), rotation("x", e[0])));
}

// Invert a column-major 4x4 (general; falls back to identity if singular).
function invert(m) {
  const inv = new Float64Array(16);
  const a = m;
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (det === 0) return identity();
  det = 1 / det;
  const out = new Float64Array(16);
  for (let i = 0; i < 16; i++) out[i] = inv[i] * det;
  return out;
}

// Decompose a rigid column-major 4x4 into { translation, rotation (quaternion
// [x,y,z,w]) }. Assumes no scale (our transforms are rotations + translations).
function decompose(m) {
  const translation = [m[12], m[13], m[14]];
  const g = (r, c) => m[c * 4 + r];
  const m00 = g(0, 0), m11 = g(1, 1), m22 = g(2, 2);
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (g(2, 1) - g(1, 2)) * s;
    y = (g(0, 2) - g(2, 0)) * s;
    z = (g(1, 0) - g(0, 1)) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (g(2, 1) - g(1, 2)) / s;
    x = 0.25 * s;
    y = (g(0, 1) + g(1, 0)) / s;
    z = (g(0, 2) + g(2, 0)) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (g(0, 2) - g(2, 0)) / s;
    x = (g(0, 1) + g(1, 0)) / s;
    y = 0.25 * s;
    z = (g(1, 2) + g(2, 1)) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (g(1, 0) - g(0, 1)) / s;
    x = (g(0, 2) + g(2, 0)) / s;
    y = (g(1, 2) + g(2, 1)) / s;
    z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  return { translation, rotation: [x / len, y / len, z / len, w / len] };
}

// Apply a column-major 4x4 to a point [x,y,z,1].
function applyPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

// Apply the linear (rotation) part of a 4x4 to a direction, normalized.
function applyDir(m, d) {
  const x = m[0] * d[0] + m[4] * d[1] + m[8] * d[2];
  const y = m[1] * d[0] + m[5] * d[1] + m[9] * d[2];
  const z = m[2] * d[0] + m[6] * d[1] + m[10] * d[2];
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

// ─────────────────────────────────────────────────────────────────────────────
// Rig posing — mirrors hierarchy.ts / clips.ts

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const isNonZero = (v) => Array.isArray(v) && (v[0] !== 0 || v[1] !== 0 || v[2] !== 0);

// A joint arrives in one of two shapes: the raw produced `rig.json` (voxel binary
// shape, `drive: { type, keyframes, periodMs, looping }`) or the run-record
// `ModelSpec` (`drive: "caller" | "auto"`, `auto: { ... }`). Normalize to the
// latter so the posing code has a single shape to read.
function normalizeJoint(j) {
  if (j.drive && typeof j.drive === "object") {
    const drive = j.drive.type === "auto" ? "auto" : "caller";
    const auto =
      drive === "auto"
        ? { keyframes: j.drive.keyframes ?? [], periodMs: j.drive.periodMs ?? 0, looping: !!j.drive.looping }
        : undefined;
    return { ...j, drive, auto };
  }
  return j;
}

function normalizeRig(rig) {
  return { ...rig, joints: (rig.joints ?? []).map(normalizeJoint) };
}

function sampleKeyframes(keyframes, timeMs, periodMs, looping) {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;
  let t = timeMs;
  const period = periodMs ?? keyframes[keyframes.length - 1].tMs;
  if (looping && period > 0) {
    t = ((t % period) + period) % period;
  } else {
    t = clamp(t, keyframes[0].tMs, keyframes[keyframes.length - 1].tMs);
  }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t >= a.tMs && t <= b.tMs) {
      const span = b.tMs - a.tMs || 1;
      const f = (t - a.tMs) / span;
      return a.value + (b.value - a.value) * f;
    }
  }
  return keyframes[keyframes.length - 1].value;
}

// The local transform a joint contributes at `value` (compound mount ∘ driven).
function jointMatrix(joint, value) {
  const p = joint.pivot;
  const negP = [-p[0], -p[1], -p[2]];
  let driven;
  if (joint.kind === "translation") {
    const t = [0, 0, 0];
    t[AXIS_INDEX[joint.axis]] = value;
    driven = translation(t);
  } else {
    driven = multiply(translation(p), multiply(rotation(joint.axis, value), translation(negP)));
  }
  const offset = joint.offset;
  const orient = joint.orient;
  if (!isNonZero(offset) && !isNonZero(orient)) return driven;
  let mount = identity();
  if (isNonZero(orient)) {
    mount = multiply(translation(p), multiply(eulerRotation(orient), translation(negP)));
  }
  if (isNonZero(offset)) mount = multiply(translation(offset), mount);
  return multiply(mount, driven);
}

function jointValue(joint, caller, timeMs) {
  let value;
  if (joint.drive === "auto") {
    value = joint.auto
      ? sampleKeyframes(joint.auto.keyframes, timeMs, joint.auto.periodMs, joint.auto.looping)
      : joint.rest;
  } else {
    const provided = caller[joint.name];
    value = provided === undefined ? joint.rest : provided;
  }
  return clamp(value, joint.min, joint.max);
}

// Resolve every part's world matrix for a pose. Returns Map<name, Float64Array16>.
function poseRig(rig, caller, timeMs) {
  const partByName = new Map(rig.parts.map((p) => [p.name, p]));
  const jointsByPart = new Map();
  for (const j of rig.joints) {
    const list = jointsByPart.get(j.part);
    if (list) list.push(j);
    else jointsByPart.set(j.part, [j]);
  }
  const worldByName = new Map();
  const resolve = (name, seen) => {
    const cached = worldByName.get(name);
    if (cached) return cached;
    const part = partByName.get(name);
    let local = identity();
    for (const j of jointsByPart.get(name) ?? []) {
      local = multiply(local, jointMatrix(j, jointValue(j, caller, timeMs)));
    }
    let world;
    if (part.parent && partByName.has(part.parent) && !seen.has(part.parent)) {
      const parentWorld = resolve(part.parent, new Set(seen).add(name));
      world = multiply(parentWorld, local);
    } else {
      world = local;
    }
    worldByName.set(name, world);
    return world;
  };
  for (const p of rig.parts) resolve(p.name, new Set([p.name]));
  return worldByName;
}

// ─────────────────────────────────────────────────────────────────────────────
// glTF buffer assembly

const FLOAT = 5126;
const UINT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

class GltfBuilder {
  constructor() {
    this.chunks = [];
    this.byteLength = 0;
    this.bufferViews = [];
    this.accessors = [];
  }

  // Append a typed array (aligned to 4 bytes) as a bufferView, return its index.
  addView(typed, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const byteOffset = this.byteLength;
    this.chunks.push(bytes);
    this.byteLength += bytes.length;
    const view = { buffer: 0, byteOffset, byteLength: bytes.length };
    if (target !== undefined) view.target = target;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }

  addAccessor(typed, componentType, type, count, { target, min, max } = {}) {
    const view = this.addView(typed, target);
    const accessor = { bufferView: view, componentType, count, type };
    if (min) accessor.min = min;
    if (max) accessor.max = max;
    this.accessors.push(accessor);
    return this.accessors.length - 1;
  }

  bin() {
    return Buffer.concat(this.chunks);
  }
}

function vec3MinMax(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const v = positions[i + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

// ─────────────────────────────────────────────────────────────────────────────
// Building the glTF document

function loadAnimations(path) {
  if (!path) return [];
  const data = readJson(path);
  const anims = Array.isArray(data)
    ? data
    : data.animations ?? data.rig?.animations ?? data.model?.animations ?? [];
  if (!Array.isArray(anims)) fail(`${path} has no animations array`);
  return anims;
}

// Union of keyframe times over one period (ms), always including 0 and periodMs.
function timelineFor(keyframeTimeSets, periodMs) {
  const set = new Set([0, periodMs]);
  for (const times of keyframeTimeSets) for (const t of times) if (t >= 0 && t <= periodMs) set.add(t);
  return [...set].sort((a, b) => a - b);
}

// Build one glTF animation from a set of driven joints, sampling the rig at each
// timeline breakpoint and emitting translation+rotation channels for the parts
// those joints move. `poseAt(t)` returns the world-matrix map for time t.
function buildAnimation(builder, name, rig, drivenJoints, timelineMs, restWorld, nodeIndexByPart, poseAt) {
  const animatedParts = [...new Set(drivenJoints.map((j) => j.part))].filter((p) => nodeIndexByPart.has(p));
  if (animatedParts.length === 0 || timelineMs.length < 2) return null;

  const timesSec = Float32Array.from(timelineMs, (t) => t / 1000);
  const inputAccessor = builder.addAccessor(timesSec, FLOAT, "SCALAR", timesSec.length, {
    min: [timesSec[0]],
    max: [timesSec[timesSec.length - 1]],
  });

  // parentWorld(t) for each animated part, to convert world → node-local TRS.
  const worldsPerTime = timelineMs.map((t) => poseAt(t));

  const samplers = [];
  const channels = [];
  for (const partName of animatedParts) {
    const part = rig.parts.find((p) => p.name === partName);
    const trans = new Float32Array(timelineMs.length * 3);
    const rot = new Float32Array(timelineMs.length * 4);
    for (let i = 0; i < timelineMs.length; i++) {
      const worlds = worldsPerTime[i];
      const world = worlds.get(partName);
      const parentWorld = part.parent && worlds.has(part.parent) ? worlds.get(part.parent) : identity();
      const local = multiply(invert(parentWorld), world);
      const { translation: tr, rotation: q } = decompose(local);
      trans.set(tr, i * 3);
      rot.set(q, i * 4);
    }
    const transAcc = builder.addAccessor(trans, FLOAT, "VEC3", timelineMs.length);
    const rotAcc = builder.addAccessor(rot, FLOAT, "VEC4", timelineMs.length);
    const node = nodeIndexByPart.get(partName);
    samplers.push({ input: inputAccessor, output: transAcc, interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node, path: "translation" } });
    samplers.push({ input: inputAccessor, output: rotAcc, interpolation: "LINEAR" });
    channels.push({ sampler: samplers.length - 1, target: { node, path: "rotation" } });
  }
  return { name, samplers, channels };
}

function build({ rig, voxelsByPart, namedAnimations, name }) {
  const builder = new GltfBuilder();
  const gltf = {
    asset: { version: "2.0", generator: "test-cabinet voxel-to-gltf" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [
      {
        name: "voxel",
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      },
    ],
    accessors: builder.accessors,
    bufferViews: builder.bufferViews,
    animations: [],
  };

  // Rest pose: parts are typically sculpted in place (rest = identity), but a
  // compound mount or an auto clip at t=0 can make a part's rest transform
  // non-identity — bake geometry into each part's rest-local frame so the node's
  // default TRS reproduces exactly where the part sits at rest.
  const restWorld = poseRig(rig, {}, 0);
  const nodeIndexByPart = new Map();

  // One node (+ mesh) per part.
  rig.parts.forEach((part, i) => {
    nodeIndexByPart.set(part.name, i);
  });

  rig.parts.forEach((part) => {
    const nodeIndex = nodeIndexByPart.get(part.name);
    const node = { name: part.name };

    // Node default local TRS = inv(parentRestWorld) · restWorld[part].
    const parentRest = part.parent && restWorld.has(part.parent) ? restWorld.get(part.parent) : identity();
    const restLocal = multiply(invert(parentRest), restWorld.get(part.name));
    const { translation: tr, rotation: q } = decompose(restLocal);
    if (tr[0] || tr[1] || tr[2]) node.translation = tr;
    if (q[0] || q[1] || q[2] || q[3] !== 1) node.rotation = q;

    // Mesh geometry, baked into the part's rest-local frame.
    const voxels = voxelsByPart[part.name];
    if (voxels && voxels.voxels.length > 0) {
      const mesh = buildPartMesh(voxels);
      const invRest = invert(restWorld.get(part.name));
      const positions = new Float32Array(mesh.positions.length);
      const normals = new Float32Array(mesh.normals.length);
      for (let v = 0; v < mesh.positions.length; v += 3) {
        const p = applyPoint(invRest, [mesh.positions[v], mesh.positions[v + 1], mesh.positions[v + 2]]);
        positions.set(p, v);
        const n = applyDir(invRest, [mesh.normals[v], mesh.normals[v + 1], mesh.normals[v + 2]]);
        normals.set(n, v);
      }
      const colors = Float32Array.from(mesh.colors);
      const indices = Uint32Array.from(mesh.indices);
      const { min, max } = vec3MinMax(positions);
      const posAcc = builder.addAccessor(positions, FLOAT, "VEC3", positions.length / 3, {
        target: ARRAY_BUFFER,
        min,
        max,
      });
      const normAcc = builder.addAccessor(normals, FLOAT, "VEC3", normals.length / 3, { target: ARRAY_BUFFER });
      const colAcc = builder.addAccessor(colors, FLOAT, "VEC3", colors.length / 3, { target: ARRAY_BUFFER });
      const idxAcc = builder.addAccessor(indices, UINT, "SCALAR", indices.length, {
        target: ELEMENT_ARRAY_BUFFER,
      });
      gltf.meshes.push({
        name: `${part.name}:mesh`,
        primitives: [
          {
            attributes: { POSITION: posAcc, NORMAL: normAcc, COLOR_0: colAcc },
            indices: idxAcc,
            material: 0,
          },
        ],
      });
      node.mesh = gltf.meshes.length - 1;
    }

    gltf.nodes.push(node);
  });

  // Parent/child wiring + scene roots.
  rig.parts.forEach((part) => {
    if (part.parent && nodeIndexByPart.has(part.parent)) {
      const parent = gltf.nodes[nodeIndexByPart.get(part.parent)];
      (parent.children ??= []).push(nodeIndexByPart.get(part.name));
    } else {
      gltf.scenes[0].nodes.push(nodeIndexByPart.get(part.name));
    }
  });

  // Named, case-authored animations (drive caller joints).
  const jointByName = new Map(rig.joints.map((j) => [j.name, j]));
  for (const anim of namedAnimations) {
    const driven = anim.tracks.map((t) => jointByName.get(t.joint)).filter(Boolean);
    const timeline = timelineFor(anim.tracks.map((t) => t.keyframes.map((k) => k.tMs)), anim.periodMs);
    const poseAt = (t) => {
      const caller = {};
      for (const track of anim.tracks) {
        caller[track.joint] = sampleKeyframes(track.keyframes, t, anim.periodMs, anim.looping);
      }
      return poseRig(rig, caller, 0);
    };
    const built = buildAnimation(builder, anim.name, rig, driven, timeline, restWorld, nodeIndexByPart, poseAt);
    if (built) gltf.animations.push(built);
  }

  // The rig's own auto-play clips, baked as one "auto-play" animation.
  const autoJoints = rig.joints.filter((j) => j.drive === "auto" && j.auto && j.auto.keyframes.length > 0);
  if (autoJoints.length > 0) {
    const maxPeriod = Math.max(...autoJoints.map((j) => j.auto.periodMs || 0), 1);
    // Sample at each auto joint's keyframe times replicated across its loops.
    const timeSets = autoJoints.map((j) => {
      const period = j.auto.periodMs || maxPeriod;
      const times = [];
      for (let base2 = 0; base2 <= maxPeriod; base2 += period || maxPeriod) {
        for (const k of j.auto.keyframes) times.push(base2 + k.tMs);
        if (!period) break;
      }
      return times;
    });
    const timeline = timelineFor(timeSets, maxPeriod);
    const poseAt = (t) => poseRig(rig, {}, t);
    const built = buildAnimation(builder, "auto-play", rig, autoJoints, timeline, restWorld, nodeIndexByPart, poseAt);
    if (built) gltf.animations.push(built);
  }

  if (gltf.animations.length === 0) delete gltf.animations;
  if (name) gltf.scenes[0].name = name;

  const bin = builder.bin();
  gltf.buffers = [{ byteLength: bin.length }];
  return { gltf, bin };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output

function writeGlb(outPath, gltf, bin) {
  const jsonBuf = Buffer.from(JSON.stringify(gltf), "utf8");
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // 'glTF'
  header.writeUInt32LE(2, 4); // version
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  header.writeUInt32LE(total, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4); // 'JSON'
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4); // 'BIN\0'

  writeFileSync(outPath, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
}

function writeGltf(outPath, gltf, bin) {
  const binName = basename(outPath, extname(outPath)) + ".bin";
  gltf.buffers = [{ byteLength: bin.length, uri: binName }];
  writeFileSync(outPath, JSON.stringify(gltf, null, 2));
  writeFileSync(join(dirname(outPath), binName), bin);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main

function main() {
  const args = parseArgs(process.argv.slice(2));
  const modelName = args.name ?? basename(args.out, extname(args.out));

  let rig;
  const voxelsByPart = {};

  if (args.rig) {
    rig = normalizeRig(readJson(args.rig));
    if (!Array.isArray(rig.parts)) fail(`${args.rig} is not a rig (no parts array)`);
    const voxelsDir = args.voxels ?? join(dirname(args.rig), "voxels");
    for (const part of rig.parts) {
      const path = join(voxelsDir, `${part.name}.json`);
      try {
        voxelsByPart[part.name] = readJson(path);
      } catch {
        process.stderr.write(`voxel-to-gltf: note: no voxels for part \`${part.name}\` at ${path}; skipping its mesh\n`);
      }
    }
  } else {
    // Static single-mesh model: one implicit "model" part, no joints.
    const voxels = readJson(args.voxels);
    if (!Array.isArray(voxels.voxels)) fail(`${args.voxels} is not a voxels.json (no voxels array)`);
    rig = { parts: [{ name: "model", pivot: [0, 0, 0] }], joints: [] };
    voxelsByPart.model = voxels;
  }

  const namedAnimations = loadAnimations(args.animations);
  const { gltf, bin } = build({ rig, voxelsByPart, namedAnimations, name: modelName });

  const ext = extname(args.out).toLowerCase();
  if (ext === ".gltf") writeGltf(args.out, gltf, bin);
  else writeGlb(args.out, gltf, bin);

  const partCount = rig.parts.length;
  const animCount = gltf.animations?.length ?? 0;
  process.stdout.write(
    `voxel-to-gltf: wrote ${args.out} — ${partCount} part${partCount === 1 ? "" : "s"}, ` +
      `${gltf.meshes.length} mesh${gltf.meshes.length === 1 ? "" : "es"}, ` +
      `${animCount} animation${animCount === 1 ? "" : "s"}\n`,
  );
}

main();
