/**
 * The WebGL2 renderer: what turns a frame's {@link FrameCommand} list into
 * pixels. It executes exactly the scene context's vocabulary — nothing else
 * ever reaches it — against any conforming `WebGL2RenderingContext`,
 * including `@test-cabinet/headless-webgl2`'s.
 *
 * Everything here mirrors `docs/engines/simple-3d/apis/game.md` (draw
 * semantics, modes, draw order) and `apis/viewport.md` (the letterboxed fit);
 * those pages are the specification, and behavior that disagrees with them is
 * wrong. Five decisions shape the module:
 *
 * 1. **A frame renders from its buffered command list, not call by call.**
 *    Issue order is not paint order: the state setters and `clearDepth`
 *    divide a frame's draws into runs, translucent draws render after their
 *    own run's opaque draws sorted farthest-first from the run's camera, and
 *    HUD draws composite last across the whole frame — none of which can be
 *    honored while the calls are still arriving.
 * 2. **One shader program draws everything.** A mode uniform selects lit,
 *    flat, or normal-visualizing shading; billboards, lines, and HUD draws
 *    are flat draws of the same program, which is what makes "they render the
 *    same under every mode" structurally true. Every shader stays inside the
 *    GLSL ES 3.00 subset `@test-cabinet/headless-webgl2` documents
 *    (`packages/headless-webgl2/docs/glsl-subset.md`), so the same sources
 *    compile there and on real drivers.
 * 3. **The fit is the viewport and the scissor.** The frame clears the whole
 *    canvas to the background — the letterbox bars included — and then pins
 *    both the viewport and the scissor to the fitted rectangle, so no draw
 *    can leak into a bar and the projection lands where `projectPoint`'s
 *    arithmetic says it lands.
 * 4. **Uploads are cached on identity and bounded.** Procedural geometry is
 *    tessellated once per distinct argument list (a bounded table, evicted
 *    oldest-first), a glTF document is parsed once per handle (a `WeakMap`,
 *    collected with the handle), and a texture is uploaded once per handle —
 *    nothing here grows with the length of a run.
 * 5. **A draw that cannot be resolved draws nothing.** A handle this engine
 *    never loaded, a glTF body that fails to parse mid-run, a color that is
 *    not a color: each skips its own draw and nothing else, because a frame
 *    must survive whatever a build hands it.
 *
 * Deliberate 1.0.0 rendering simplifications, all invisible to the recording
 * (which carries the calls, not the shading): normal maps are not sampled
 * (no tangent basis), glTF skinning poses nodes rigidly (joint palettes are
 * ignored; node TRS animation is honored), and lighting is a bounded
 * Lambert-plus-Blinn model driven by roughness/metallic rather than a full
 * BRDF. The docs pin no lit pixel's bytes, so validators are unaffected.
 */

import type { LightState, RenderMode } from "./contract";
import { LIGHT_LIMIT } from "./contract";
import type { CameraState, Quat, Transform, Vec3, Viewport } from "./math";
import { rotateVec3 } from "./math";
import type { MeshHandle, TextureHandle } from "./assets";
import { meshSource, textureSource } from "./assets";
import { decodePng } from "./png";
import {
  FONT_CELL_HEIGHT,
  FONT_CELL_WIDTH,
  FONT_FIRST_CODE_POINT,
  FONT_LAST_CODE_POINT,
  glyphRows,
} from "./font";
import type {
  FrameCommand,
  GeometrySpec,
  ResolvedMaterial,
  SceneFrame,
} from "./scene";

/* -------------------------------------------------------------------------- */
/* CSS colors                                                                 */
/* -------------------------------------------------------------------------- */

/** The handful of keyword colors a game plausibly writes; everything else is spelled numerically. */
const NAMED_COLORS: Readonly<
  Record<string, readonly [number, number, number, number]>
> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  lime: [0, 1, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  orange: [1, 165 / 255, 0, 1],
  purple: [128 / 255, 0, 128 / 255, 1],
};

/** One hue-to-channel leg of the HSL conversion. */
function hueChannel(p: number, q: number, t: number): number {
  let h = t;
  if (h < 0) h += 1;
  if (h > 1) h -= 1;
  if (h < 1 / 6) return p + (q - p) * 6 * h;
  if (h < 1 / 2) return q;
  if (h < 2 / 3) return p + (q - p) * (2 / 3 - h) * 6;
  return p;
}

/**
 * Parses a CSS color to RGBA in `0..1`: hex in all four widths, `rgb()`/
 * `rgba()`, `hsl()`/`hsla()`, and the small keyword table. An unparseable
 * string renders as opaque white rather than throwing, because a bad color is
 * a bad pixel, not a bad frame — the recording still carries the exact string
 * the build supplied.
 */
export function parseColor(css: string): [number, number, number, number] {
  if (typeof css !== "string") return [1, 1, 1, 1];
  const text = css.trim().toLowerCase();
  const named = NAMED_COLORS[text];
  if (named !== undefined) return [named[0], named[1], named[2], named[3]];

  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (/^[0-9a-f]+$/.test(hex)) {
      if (hex.length === 3 || hex.length === 4) {
        const parts = hex.split("").map((c) => parseInt(c + c, 16) / 255);
        return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
      }
      if (hex.length === 6 || hex.length === 8) {
        const at = (i: number): number =>
          parseInt(hex.slice(i, i + 2), 16) / 255;
        return [at(0), at(2), at(4), hex.length === 8 ? at(6) : 1];
      }
    }
    return [1, 1, 1, 1];
  }

  const call = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (call !== null) {
    const parts = (call[2] ?? "")
      .split(/[\s,/]+/)
      .filter((part) => part !== "");
    const numberAt = (index: number, scale: number): number => {
      const raw = parts[index];
      if (raw === undefined) return 0;
      const percent = raw.endsWith("%");
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) return 0;
      return percent ? value / 100 : value / scale;
    };
    const alpha =
      parts.length > 3 ? Math.min(1, Math.max(0, numberAt(3, 1))) : 1;
    if ((call[1] ?? "").startsWith("rgb")) {
      const clamp = (v: number): number => Math.min(1, Math.max(0, v));
      return [
        clamp(numberAt(0, 255)),
        clamp(numberAt(1, 255)),
        clamp(numberAt(2, 255)),
        alpha,
      ];
    }
    const h = (((Number.parseFloat(parts[0] ?? "0") % 360) + 360) % 360) / 360;
    const s = Math.min(1, Math.max(0, numberAt(1, 100)));
    const l = Math.min(1, Math.max(0, numberAt(2, 100)));
    if (s === 0) return [l, l, l, alpha];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      hueChannel(p, q, h + 1 / 3),
      hueChannel(p, q, h),
      hueChannel(p, q, h - 1 / 3),
      alpha,
    ];
  }

  return [1, 1, 1, 1];
}

/* -------------------------------------------------------------------------- */
/* Matrices — column-major, as GL takes them                                  */
/* -------------------------------------------------------------------------- */

type Mat4 = number[];
type Mat3 = number[];

/** The identity. */
function identity4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** `a * b`. */
function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1)
        sum += (a[k * 4 + r] ?? 0) * (b[c * 4 + k] ?? 0);
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

/** The rotation matrix of a quaternion, as a mat3 in column-major order. */
function quatToMat3(q: Quat): Mat3 {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
  ];
}

/** The TRS composition — scale, then rotation, then translation — as a mat4. */
function trsMatrix(t: Transform): Mat4 {
  const r = quatToMat3(t.rotation);
  const s = t.scale;
  return [
    (r[0] ?? 0) * s.x,
    (r[1] ?? 0) * s.x,
    (r[2] ?? 0) * s.x,
    0,
    (r[3] ?? 0) * s.y,
    (r[4] ?? 0) * s.y,
    (r[5] ?? 0) * s.y,
    0,
    (r[6] ?? 0) * s.z,
    (r[7] ?? 0) * s.z,
    (r[8] ?? 0) * s.z,
    0,
    t.position.x,
    t.position.y,
    t.position.z,
    1,
  ];
}

/**
 * The camera's view matrix: the inverse of its translate-rotate pose, built
 * directly from the conjugate quaternion so no general inversion is needed.
 */
function viewMatrix(camera: CameraState): Mat4 {
  const q = camera.rotation;
  const r = quatToMat3({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
  const p = camera.position;
  const tx = -((r[0] ?? 0) * p.x + (r[3] ?? 0) * p.y + (r[6] ?? 0) * p.z);
  const ty = -((r[1] ?? 0) * p.x + (r[4] ?? 0) * p.y + (r[7] ?? 0) * p.z);
  const tz = -((r[2] ?? 0) * p.x + (r[5] ?? 0) * p.y + (r[8] ?? 0) * p.z);
  return [
    r[0] ?? 0,
    r[1] ?? 0,
    r[2] ?? 0,
    0,
    r[3] ?? 0,
    r[4] ?? 0,
    r[5] ?? 0,
    0,
    r[6] ?? 0,
    r[7] ?? 0,
    r[8] ?? 0,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/**
 * The perspective projection at the design aspect. The aspect is always the
 * viewport's `width / height` — the camera carries no aspect field — which is
 * what keeps the picture identical on any canvas and keeps this projection in
 * lockstep with `projectPoint`'s.
 */
function perspectiveMatrix(camera: CameraState, aspect: number): Mat4 {
  const f = 1 / Math.tan(camera.fovY / 2);
  const { near, far } = camera;
  const out = new Array<number>(16).fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/**
 * The normal matrix: the inverse-transpose of the model's upper 3×3, built
 * from column cross products. A singular model (a zero scale) answers the
 * identity rather than NaN, so a degenerate draw shades flat instead of
 * poisoning the varyings.
 */
function normalMatrix(model: Mat4): Mat3 {
  const c0: Vec3 = { x: model[0] ?? 0, y: model[1] ?? 0, z: model[2] ?? 0 };
  const c1: Vec3 = { x: model[4] ?? 0, y: model[5] ?? 0, z: model[6] ?? 0 };
  const c2: Vec3 = { x: model[8] ?? 0, y: model[9] ?? 0, z: model[10] ?? 0 };
  const cross = (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  });
  const x12 = cross(c1, c2);
  const det = c0.x * x12.x + c0.y * x12.y + c0.z * x12.z;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const x20 = cross(c2, c0);
  const x01 = cross(c0, c1);
  return [
    x12.x / det,
    x12.y / det,
    x12.z / det,
    x20.x / det,
    x20.y / det,
    x20.z / det,
    x01.x / det,
    x01.y / det,
    x01.z / det,
  ];
}

/** Whether every entry of a matrix is finite — the guard before a run draws. */
function finiteMat(m: number[]): boolean {
  for (const value of m) if (!Number.isFinite(value)) return false;
  return true;
}

/* -------------------------------------------------------------------------- */
/* Shaders — inside the documented GLSL ES 3.00 subset                        */
/* -------------------------------------------------------------------------- */

const VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;
uniform mat3 u_normal_matrix;
out vec3 v_normal;
out vec2 v_uv;
out vec3 v_world;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  v_world = world.xyz;
  v_normal = u_normal_matrix * a_normal;
  v_uv = a_uv;
  gl_Position = u_proj * (u_view * world);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
uniform int u_mode;
uniform vec4 u_base;
uniform vec3 u_emissive;
uniform float u_roughness;
uniform float u_metallic;
uniform int u_has_map;
uniform sampler2D u_map;
uniform vec3 u_camera;
uniform int u_light_count;
uniform vec4 u_light_a[64];
uniform vec4 u_light_b[64];
uniform float u_light_range[64];
in vec3 v_normal;
in vec2 v_uv;
in vec3 v_world;
out vec4 o_color;
void main() {
  vec4 base = u_base;
  if (u_has_map == 1) {
    base = base * texture(u_map, v_uv);
  }
  if (u_mode == 2) {
    vec3 shown = normalize(v_normal) * 0.5 + 0.5;
    o_color = vec4(shown, 1.0);
    return;
  }
  if (u_mode == 1) {
    o_color = base;
    return;
  }
  vec3 n = normalize(v_normal);
  vec3 view_dir = normalize(u_camera - v_world);
  float gloss = 1.0 - u_roughness;
  float shininess = 2.0 + gloss * gloss * 254.0;
  vec3 diffuse_color = base.rgb * (1.0 - u_metallic);
  vec3 spec_color = mix(vec3(0.04), base.rgb, u_metallic);
  vec3 lit = vec3(0.0);
  for (int i = 0; i < u_light_count; i++) {
    vec3 tint = u_light_b[i].rgb * u_light_b[i].a;
    float kind = u_light_a[i].w;
    if (kind < 0.5) {
      lit = lit + tint * base.rgb;
    } else {
      vec3 to_light = vec3(0.0);
      float weight = 1.0;
      if (kind < 1.5) {
        to_light = normalize(vec3(0.0) - u_light_a[i].xyz);
      } else {
        vec3 offset = u_light_a[i].xyz - v_world;
        to_light = normalize(offset);
        float range = u_light_range[i];
        if (range > 0.0) {
          float falloff = clamp(1.0 - length(offset) / range, 0.0, 1.0);
          weight = falloff * falloff;
        }
      }
      float lambert = max(dot(n, to_light), 0.0);
      float spec = pow(max(dot(n, normalize(to_light + view_dir)), 0.0), shininess) * gloss;
      lit = lit + tint * weight * (diffuse_color * lambert + spec_color * spec);
    }
  }
  o_color = vec4(lit + u_emissive, base.a);
}
`;

/* -------------------------------------------------------------------------- */
/* Procedural tessellation                                                    */
/* -------------------------------------------------------------------------- */

/** One tessellated body, ready to upload. */
interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
}

/** Radial segments for every lathed body — the documented 32. */
const RADIAL_SEGMENTS = 32;

/** One point of a lathe profile: height, radius, and the outward normal in the (radial, y) plane. */
interface ProfilePoint {
  y: number;
  r: number;
  nr: number;
  ny: number;
}

/** Revolves a profile around the local Y axis into a closed grid of quads. */
function lathe(profile: readonly ProfilePoint[], slices: number): MeshData {
  const rows = profile.length;
  const stride = slices + 1;
  const positions = new Float32Array(rows * stride * 3);
  const normals = new Float32Array(rows * stride * 3);
  const uvs = new Float32Array(rows * stride * 2);
  for (let j = 0; j < rows; j += 1) {
    const point = profile[j];
    if (point === undefined) continue;
    for (let s = 0; s <= slices; s += 1) {
      const angle = (s / slices) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const at = (j * stride + s) * 3;
      positions[at] = point.r * cos;
      positions[at + 1] = point.y;
      positions[at + 2] = point.r * sin;
      normals[at] = point.nr * cos;
      normals[at + 1] = point.ny;
      normals[at + 2] = point.nr * sin;
      uvs[(j * stride + s) * 2] = s / slices;
      uvs[(j * stride + s) * 2 + 1] = j / (rows - 1);
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < rows - 1; j += 1) {
    for (let s = 0; s < slices; s += 1) {
      const a = j * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, normals, uvs, indices: Uint32Array.from(indices) };
}

/** The unit-box faces, scaled to `size`, with hard edges and per-face UVs. */
function buildBox(size: Vec3): MeshData {
  const x = size.x / 2;
  const y = size.y / 2;
  const z = size.z / 2;
  // Per face: normal, then four corners in fan order.
  const faces: Array<[Vec3, Vec3, Vec3, Vec3, Vec3]> = [
    [
      { x: 0, y: 0, z: 1 },
      { x: -x, y: -y, z },
      { x, y: -y, z },
      { x, y, z },
      { x: -x, y, z },
    ],
    [
      { x: 0, y: 0, z: -1 },
      { x, y: -y, z: -z },
      { x: -x, y: -y, z: -z },
      { x: -x, y, z: -z },
      { x, y, z: -z },
    ],
    [
      { x: 1, y: 0, z: 0 },
      { x, y: -y, z },
      { x, y: -y, z: -z },
      { x, y, z: -z },
      { x, y, z },
    ],
    [
      { x: -1, y: 0, z: 0 },
      { x: -x, y: -y, z: -z },
      { x: -x, y: -y, z },
      { x: -x, y, z },
      { x: -x, y, z: -z },
    ],
    [
      { x: 0, y: 1, z: 0 },
      { x: -x, y, z },
      { x, y, z },
      { x, y, z: -z },
      { x: -x, y, z: -z },
    ],
    [
      { x: 0, y: -1, z: 0 },
      { x: -x, y: -y, z: -z },
      { x, y: -y, z: -z },
      { x, y: -y, z },
      { x: -x, y: -y, z },
    ],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const corner_uv = [0, 0, 1, 0, 1, 1, 0, 1];
  faces.forEach(([normal, ...corners], face) => {
    corners.forEach((corner, i) => {
      positions.push(corner.x, corner.y, corner.z);
      normals.push(normal.x, normal.y, normal.z);
      uvs.push(corner_uv[i * 2] ?? 0, corner_uv[i * 2 + 1] ?? 0);
    });
    const base = face * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

/** Tessellates one {@link GeometrySpec} into the documented segment counts. */
function buildGeometry(spec: GeometrySpec): MeshData {
  if (spec.shape === "box") return buildBox(spec.size);
  if (spec.shape === "plane") {
    const w = spec.width / 2;
    const d = spec.depth / 2;
    return {
      positions: Float32Array.from([-w, 0, -d, w, 0, -d, w, 0, d, -w, 0, d]),
      normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
    };
  }
  if (spec.shape === "sphere") {
    const stacks = 16;
    const profile: ProfilePoint[] = [];
    for (let j = 0; j <= stacks; j += 1) {
      const phi = -Math.PI / 2 + (j / stacks) * Math.PI;
      profile.push({
        y: spec.radius * Math.sin(phi),
        r: spec.radius * Math.cos(phi),
        nr: Math.cos(phi),
        ny: Math.sin(phi),
      });
    }
    return lathe(profile, RADIAL_SEGMENTS);
  }
  if (spec.shape === "cylinder") {
    const { radius, height } = spec;
    const h = height / 2;
    // Duplicated rim points carry the cap normal and the side normal apiece,
    // so the caps shade flat and the side shades round.
    const profile: ProfilePoint[] = [
      { y: -h, r: 0, nr: 0, ny: -1 },
      { y: -h, r: radius, nr: 0, ny: -1 },
      { y: -h, r: radius, nr: 1, ny: 0 },
      { y: h, r: radius, nr: 1, ny: 0 },
      { y: h, r: radius, nr: 0, ny: 1 },
      { y: h, r: 0, nr: 0, ny: 1 },
    ];
    return lathe(profile, RADIAL_SEGMENTS);
  }
  // Capsule: each hemispherical cap is 8 rings, and the side falls out of the
  // seam between the two profiles' equator points, whose normals agree.
  const capRings = 8;
  const { radius, height } = spec;
  const profile: ProfilePoint[] = [];
  for (let j = 0; j <= capRings; j += 1) {
    const phi = -Math.PI / 2 + (j / capRings) * (Math.PI / 2);
    profile.push({
      y: -height / 2 + radius * Math.sin(phi),
      r: radius * Math.cos(phi),
      nr: Math.cos(phi),
      ny: Math.sin(phi),
    });
  }
  for (let j = 0; j <= capRings; j += 1) {
    const phi = (j / capRings) * (Math.PI / 2);
    profile.push({
      y: height / 2 + radius * Math.sin(phi),
      r: radius * Math.cos(phi),
      nr: Math.cos(phi),
      ny: Math.sin(phi),
    });
  }
  return lathe(profile, RADIAL_SEGMENTS);
}

/** The unique undirected edges of an indexed triangle list, as LINES indices — the wireframe body. */
function edgeIndices(indices: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
    for (let e = 0; e < 3; e += 1) {
      const a = tri[e] ?? 0;
      const b = tri[(e + 1) % 3] ?? 0;
      const key = a < b ? a * 0x100000 + b : b * 0x100000 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, b);
    }
  }
  return Uint32Array.from(out);
}

/* -------------------------------------------------------------------------- */
/* glTF drawing data                                                          */
/* -------------------------------------------------------------------------- */

/** `value` as a plain object, or `null`. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** `value` as a finite number, or `null`. */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A fixed-length numeric array field, or `null`. */
function numbersOf(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length < length) return null;
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) {
    const n = asNumber(value[i]);
    if (n === null) return null;
    out.push(n);
  }
  return out;
}

/** Components per glTF accessor type. */
const TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

/** Bytes per glTF component type. */
const COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

/**
 * Reads one accessor into a flat `Float32Array`, denormalizing normalized
 * integer components. Returns `null` for anything malformed — the caller
 * skips what it cannot read.
 */
function readAccessor(
  json: Readonly<Record<string, unknown>>,
  bin: Uint8Array | null,
  index: number,
): { data: Float32Array; components: number } | null {
  const accessors = Array.isArray(json["accessors"]) ? json["accessors"] : [];
  const views = Array.isArray(json["bufferViews"]) ? json["bufferViews"] : [];
  const accessor = asRecord(accessors[index]);
  if (accessor === null || bin === null) return null;
  const componentType = asNumber(accessor["componentType"]);
  const count = asNumber(accessor["count"]);
  const type = typeof accessor["type"] === "string" ? accessor["type"] : "";
  const components = TYPE_COMPONENTS[type];
  const bytes =
    componentType === null ? undefined : COMPONENT_BYTES[componentType];
  const viewIndex = asNumber(accessor["bufferView"]);
  if (
    components === undefined ||
    bytes === undefined ||
    count === null ||
    viewIndex === null
  )
    return null;
  const view = asRecord(views[viewIndex]);
  if (view === null) return null;
  const viewOffset = asNumber(view["byteOffset"]) ?? 0;
  const accessorOffset = asNumber(accessor["byteOffset"]) ?? 0;
  const stride = asNumber(view["byteStride"]) ?? components * bytes;
  const normalized = accessor["normalized"] === true;
  const base = viewOffset + accessorOffset;
  if (base + (count - 1) * stride + components * bytes > bin.length)
    return null;

  const reader = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(count * components);
  for (let i = 0; i < count; i += 1) {
    for (let c = 0; c < components; c += 1) {
      const at = base + i * stride + c * bytes;
      let value: number;
      if (componentType === 5126) value = reader.getFloat32(at, true);
      else if (componentType === 5125) value = reader.getUint32(at, true);
      else if (componentType === 5123) value = reader.getUint16(at, true);
      else if (componentType === 5122) value = reader.getInt16(at, true);
      else if (componentType === 5121) value = reader.getUint8(at);
      else value = reader.getInt8(at);
      if (normalized) {
        if (componentType === 5121) value /= 255;
        else if (componentType === 5123) value /= 65535;
        else if (componentType === 5120) value = Math.max(value / 127, -1);
        else if (componentType === 5122) value = Math.max(value / 32767, -1);
      }
      out[i * components + c] = value;
    }
  }
  return { data: out, components };
}

/** One drawable glTF primitive with its file material resolved to figures. */
interface DrawablePrimitive {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  emissive: [number, number, number];
  /** Index into the document's texture list, or `null` for an untextured primitive. */
  texture: number | null;
  /** `true` when the file marks the material as blended or its base alpha is below one. */
  translucent: boolean;
  gpu: GpuMesh | null;
  edges: GpuEdges | null;
}

/** One node of the drawable hierarchy, its TRS kept mutable-shaped for posing. */
interface DrawableNode {
  matrix: Mat4 | null;
  translation: Vec3;
  rotation: Quat;
  scale: Vec3;
  children: number[];
  mesh: number | null;
}

/** One animation channel, ready to sample. */
interface DrawableChannel {
  node: number;
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  components: number;
  interpolation: string;
}

/** One named clip. */
interface DrawableClip {
  duration: number;
  channels: DrawableChannel[];
}

/** A parsed, drawable glTF document. */
interface DrawableDoc {
  nodes: DrawableNode[];
  roots: number[];
  meshes: DrawablePrimitive[][];
  clips: Map<string, DrawableClip>;
  /** Decoded embedded textures by texture index; `null` marks one that failed to decode. */
  textures: ({
    pixels: Uint8Array;
    width: number;
    height: number;
    gpu: WebGLTexture | null;
  } | null)[];
}

/** Computes averaged vertex normals for a primitive whose file carries none. */
function computeNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = (indices[i] ?? 0) * 3;
    const b = (indices[i + 1] ?? 0) * 3;
    const c = (indices[i + 2] ?? 0) * 3;
    const ux = (positions[b] ?? 0) - (positions[a] ?? 0);
    const uy = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const uz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const vx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const vy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const vz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const at of [a, b, c]) {
      normals[at] = (normals[at] ?? 0) + nx;
      normals[at + 1] = (normals[at + 1] ?? 0) + ny;
      normals[at + 2] = (normals[at + 2] ?? 0) + nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const x = normals[v] ?? 0;
    const y = normals[v + 1] ?? 0;
    const z = normals[v + 2] ?? 0;
    const len = Math.hypot(x, y, z);
    if (len > 0) {
      normals[v] = x / len;
      normals[v + 1] = y / len;
      normals[v + 2] = z / len;
    }
  }
  return normals;
}

/** Parses a mesh handle's document into drawable form; `null` for a handle this engine never loaded or a body it cannot draw. */
function parseDrawable(handle: MeshHandle): DrawableDoc | null {
  const source = meshSource(handle);
  if (source === undefined) return null;
  const json = source.json;
  const bin = source.bin;

  const jsonMeshes = Array.isArray(json["meshes"]) ? json["meshes"] : [];
  const jsonMaterials = Array.isArray(json["materials"])
    ? json["materials"]
    : [];
  const meshes: DrawablePrimitive[][] = jsonMeshes.map((entry) => {
    const mesh = asRecord(entry);
    const primitives =
      mesh !== null && Array.isArray(mesh["primitives"])
        ? mesh["primitives"]
        : [];
    const out: DrawablePrimitive[] = [];
    for (const raw of primitives) {
      const primitive = asRecord(raw);
      const attributes =
        primitive === null ? null : asRecord(primitive["attributes"]);
      const positionAt =
        attributes === null ? null : asNumber(attributes["POSITION"]);
      if (primitive === null || attributes === null || positionAt === null)
        continue;
      const positionRead = readAccessor(json, bin, positionAt);
      if (positionRead === null || positionRead.components !== 3) continue;
      const positions = positionRead.data;

      const indexAt = asNumber(primitive["indices"]);
      let indices: Uint32Array;
      if (indexAt === null) {
        indices = new Uint32Array(positions.length / 3);
        for (let i = 0; i < indices.length; i += 1) indices[i] = i;
      } else {
        const read = readAccessor(json, bin, indexAt);
        if (read === null) continue;
        indices = Uint32Array.from(read.data);
      }

      const normalAt = asNumber(attributes["NORMAL"]);
      const normalRead =
        normalAt === null ? null : readAccessor(json, bin, normalAt);
      const normals =
        normalRead !== null && normalRead.components === 3
          ? normalRead.data
          : computeNormals(positions, indices);

      const uvAt = asNumber(attributes["TEXCOORD_0"]);
      const uvRead = uvAt === null ? null : readAccessor(json, bin, uvAt);
      const uvs =
        uvRead !== null && uvRead.components === 2 ? uvRead.data : null;

      // The file material's figures; glTF's own defaults where absent.
      let baseColor: [number, number, number, number] = [1, 1, 1, 1];
      let metallic = 1;
      let roughness = 1;
      let emissive: [number, number, number] = [0, 0, 0];
      let texture: number | null = null;
      let translucent = false;
      const materialAt = asNumber(primitive["material"]);
      const material =
        materialAt === null ? null : asRecord(jsonMaterials[materialAt]);
      if (material !== null) {
        const pbr = asRecord(material["pbrMetallicRoughness"]);
        if (pbr !== null) {
          const factor = numbersOf(pbr["baseColorFactor"], 4);
          if (factor !== null)
            baseColor = [
              factor[0] ?? 1,
              factor[1] ?? 1,
              factor[2] ?? 1,
              factor[3] ?? 1,
            ];
          metallic = asNumber(pbr["metallicFactor"]) ?? 1;
          roughness = asNumber(pbr["roughnessFactor"]) ?? 1;
          const baseTexture = asRecord(pbr["baseColorTexture"]);
          texture =
            baseTexture === null ? null : asNumber(baseTexture["index"]);
        }
        const emissiveFactor = numbersOf(material["emissiveFactor"], 3);
        if (emissiveFactor !== null)
          emissive = [
            emissiveFactor[0] ?? 0,
            emissiveFactor[1] ?? 0,
            emissiveFactor[2] ?? 0,
          ];
        translucent = material["alphaMode"] === "BLEND" || baseColor[3] < 1;
      }

      out.push({
        positions,
        normals,
        uvs,
        indices,
        baseColor,
        metallic,
        roughness,
        emissive,
        texture,
        translucent,
        gpu: null,
        edges: null,
      });
    }
    return out;
  });

  const jsonNodes = Array.isArray(json["nodes"]) ? json["nodes"] : [];
  const nodes: DrawableNode[] = jsonNodes.map((entry) => {
    const node = asRecord(entry) ?? {};
    const matrix = numbersOf(node["matrix"], 16);
    const t = numbersOf(node["translation"], 3);
    const r = numbersOf(node["rotation"], 4);
    const s = numbersOf(node["scale"], 3);
    const children = Array.isArray(node["children"])
      ? node["children"].map(asNumber).filter((n): n is number => n !== null)
      : [];
    return {
      matrix,
      translation: { x: t?.[0] ?? 0, y: t?.[1] ?? 0, z: t?.[2] ?? 0 },
      rotation: {
        x: r?.[0] ?? 0,
        y: r?.[1] ?? 0,
        z: r?.[2] ?? 0,
        w: r?.[3] ?? 1,
      },
      scale: { x: s?.[0] ?? 1, y: s?.[1] ?? 1, z: s?.[2] ?? 1 },
      children,
      mesh: asNumber(node["mesh"]),
    };
  });

  // The default scene's roots; without one, every node no other node claims.
  const scenes = Array.isArray(json["scenes"]) ? json["scenes"] : [];
  const scene = asRecord(scenes[asNumber(json["scene"]) ?? 0]);
  let roots: number[] = [];
  if (scene !== null && Array.isArray(scene["nodes"])) {
    roots = scene["nodes"].map(asNumber).filter((n): n is number => n !== null);
  } else {
    const claimed = new Set<number>();
    for (const node of nodes)
      for (const child of node.children) claimed.add(child);
    roots = nodes
      .map((_, index) => index)
      .filter((index) => !claimed.has(index));
  }

  // Animations, grouped by name into clips; a nameless animation cannot be
  // addressed by `drawMesh` and is left out, matching the handle's `clips`.
  const clips = new Map<string, DrawableClip>();
  const animations = Array.isArray(json["animations"])
    ? json["animations"]
    : [];
  for (const raw of animations) {
    const animation = asRecord(raw);
    const name = animation === null ? null : animation["name"];
    if (animation === null || typeof name !== "string" || name === "") continue;
    const samplers = Array.isArray(animation["samplers"])
      ? animation["samplers"]
      : [];
    const rawChannels = Array.isArray(animation["channels"])
      ? animation["channels"]
      : [];
    const channels: DrawableChannel[] = [];
    let duration = 0;
    for (const channelRaw of rawChannels) {
      const channel = asRecord(channelRaw);
      const target = channel === null ? null : asRecord(channel["target"]);
      const samplerAt = channel === null ? null : asNumber(channel["sampler"]);
      const sampler = samplerAt === null ? null : asRecord(samplers[samplerAt]);
      const node = target === null ? null : asNumber(target["node"]);
      const path = target === null ? null : target["path"];
      if (
        sampler === null ||
        node === null ||
        (path !== "translation" && path !== "rotation" && path !== "scale")
      )
        continue;
      const inputAt = asNumber(sampler["input"]);
      const outputAt = asNumber(sampler["output"]);
      if (inputAt === null || outputAt === null) continue;
      const input = readAccessor(json, bin, inputAt);
      const output = readAccessor(json, bin, outputAt);
      if (input === null || output === null) continue;
      const interpolation =
        typeof sampler["interpolation"] === "string"
          ? sampler["interpolation"]
          : "LINEAR";
      const last = input.data[input.data.length - 1] ?? 0;
      duration = Math.max(duration, last);
      channels.push({
        node,
        path,
        times: input.data,
        values: output.data,
        components: output.components,
        interpolation,
      });
    }
    clips.set(name, { duration, channels });
  }

  // Embedded textures: image bufferViews decoded as PNG. A `uri` image or a
  // body the decoder refuses marks its slot `null`, and its primitives draw
  // untextured rather than not at all.
  const jsonTextures = Array.isArray(json["textures"]) ? json["textures"] : [];
  const jsonImages = Array.isArray(json["images"]) ? json["images"] : [];
  const views = Array.isArray(json["bufferViews"]) ? json["bufferViews"] : [];
  const textures = jsonTextures.map((entry) => {
    const texture = asRecord(entry);
    const sourceAt = texture === null ? null : asNumber(texture["source"]);
    const image = sourceAt === null ? null : asRecord(jsonImages[sourceAt]);
    const viewAt = image === null ? null : asNumber(image["bufferView"]);
    const view = viewAt === null ? null : asRecord(views[viewAt]);
    if (view === null || bin === null) return null;
    const offset = asNumber(view["byteOffset"]) ?? 0;
    const length = asNumber(view["byteLength"]) ?? 0;
    try {
      const decoded = decodePng(bin.subarray(offset, offset + length));
      return {
        pixels: decoded.pixels,
        width: decoded.width,
        height: decoded.height,
        gpu: null,
      };
    } catch {
      return null;
    }
  });

  return { nodes, roots, meshes, clips, textures };
}

/** Samples one channel at `t` (already wrapped into the clip), returning `components` numbers. */
function sampleChannel(channel: DrawableChannel, t: number): number[] {
  const times = channel.times;
  const count = times.length;
  const cubic = channel.interpolation === "CUBICSPLINE";
  // CUBICSPLINE stores in-tangent, value, out-tangent per key; the value is
  // the middle element, sampled linearly — a deliberate simplification.
  const stride = cubic ? channel.components * 3 : channel.components;
  const valueAt = (key: number, c: number): number =>
    channel.values[key * stride + (cubic ? channel.components : 0) + c] ?? 0;

  if (count === 0) return new Array<number>(channel.components).fill(0);
  if (t <= (times[0] ?? 0))
    return Array.from({ length: channel.components }, (_, c) => valueAt(0, c));
  const last = count - 1;
  if (t >= (times[last] ?? 0))
    return Array.from({ length: channel.components }, (_, c) =>
      valueAt(last, c),
    );

  let k = 0;
  while (k + 1 < count && (times[k + 1] ?? 0) < t) k += 1;
  const t0 = times[k] ?? 0;
  const t1 = times[k + 1] ?? t0;
  const span = t1 - t0;
  let u = span > 0 ? (t - t0) / span : 0;
  if (channel.interpolation === "STEP") u = 0;

  const a = Array.from({ length: channel.components }, (_, c) => valueAt(k, c));
  const b = Array.from({ length: channel.components }, (_, c) =>
    valueAt(k + 1, c),
  );
  if (channel.path === "rotation" && channel.components === 4) {
    // Normalized lerp along the shorter arc — pose sampling is a pure
    // function of the arguments, and nlerp keeps it cheap and exact enough.
    let dot = 0;
    for (let c = 0; c < 4; c += 1) dot += (a[c] ?? 0) * (b[c] ?? 0);
    const sign = dot < 0 ? -1 : 1;
    const out = a.map((av, c) => (av ?? 0) * (1 - u) + (b[c] ?? 0) * sign * u);
    const len = Math.hypot(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0, out[3] ?? 0);
    return len > 0 ? out.map((v) => (v ?? 0) / len) : [0, 0, 0, 1];
  }
  return a.map((av, c) => (av ?? 0) * (1 - u) + (b[c] ?? 0) * u);
}

/** The world matrix of every node, posed by `clip` at `time` seconds when one is named. */
function poseNodes(
  doc: DrawableDoc,
  clip: DrawableClip | null,
  time: number,
): Mat4[] {
  // A node carrying an explicit `matrix` cannot be animated (glTF forbids
  // it), so the TRS-vs-matrix choice needs no per-clip variant.
  const locals = doc.nodes.map((node) =>
    node.matrix !== null
      ? node.matrix.slice()
      : trsMatrix({
          position: node.translation,
          rotation: node.rotation,
          scale: node.scale,
        }),
  );

  if (clip !== null) {
    const overrides = new Map<number, { t?: Vec3; r?: Quat; s?: Vec3 }>();
    const wrapped =
      clip.duration > 0
        ? ((time % clip.duration) + clip.duration) % clip.duration
        : 0;
    for (const channel of clip.channels) {
      const sampled = sampleChannel(channel, wrapped);
      const entry = overrides.get(channel.node) ?? {};
      if (channel.path === "translation")
        entry.t = {
          x: sampled[0] ?? 0,
          y: sampled[1] ?? 0,
          z: sampled[2] ?? 0,
        };
      else if (channel.path === "rotation")
        entry.r = {
          x: sampled[0] ?? 0,
          y: sampled[1] ?? 0,
          z: sampled[2] ?? 0,
          w: sampled[3] ?? 1,
        };
      else
        entry.s = {
          x: sampled[0] ?? 1,
          y: sampled[1] ?? 1,
          z: sampled[2] ?? 1,
        };
      overrides.set(channel.node, entry);
    }
    for (const [index, entry] of overrides) {
      const node = doc.nodes[index];
      if (node === undefined) continue;
      locals[index] = trsMatrix({
        position: entry.t ?? node.translation,
        rotation: entry.r ?? node.rotation,
        scale: entry.s ?? node.scale,
      });
    }
  }

  const worlds: Mat4[] = doc.nodes.map(() => identity4());
  const walk = (index: number, parent: Mat4, onPath: Set<number>): void => {
    if (onPath.has(index)) return;
    const local = locals[index];
    const node = doc.nodes[index];
    if (local === undefined || node === undefined) return;
    onPath.add(index);
    const world = multiply4(parent, local);
    worlds[index] = world;
    for (const child of node.children) walk(child, world, onPath);
    onPath.delete(index);
  };
  for (const root of doc.roots) walk(root, identity4(), new Set());
  return worlds;
}

/* -------------------------------------------------------------------------- */
/* GPU plumbing                                                               */
/* -------------------------------------------------------------------------- */

/** One uploaded indexed body. */
interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
}

/** One uploaded wireframe edge list, sharing the body's position buffer. */
interface GpuEdges {
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
  count: number;
}

/** How many distinct procedural argument lists stay uploaded at once. */
const GEOMETRY_CACHE_LIMIT = 256;

/** The figures one shading pass needs beside the geometry. */
interface SurfaceUniforms {
  base: readonly [number, number, number, number];
  emissive: readonly [number, number, number];
  roughness: number;
  metallic: number;
  texture: WebGLTexture | null;
  /** `0` lit, `1` flat, `2` normals. */
  mode: number;
}

/** The per-run projection figures, computed once per run. */
interface RunState {
  camera: CameraState;
  lights: readonly LightState[];
  mode: RenderMode;
  proj: Mat4;
  view: Mat4;
  drawable: boolean;
}

/** One buffered draw of the current run. */
interface PendingDraw {
  command: FrameCommand;
  distance: number;
}

/** What `renderFrame` takes: the fit, the backing store, the clear color, and the frame. */
export interface RenderFrameOptions {
  /** The letterboxed fit in force, as `fitViewport`/`syncCanvas` computed it. */
  viewport: Viewport;
  /** The canvas backing store, in device pixels. */
  surface: { width: number; height: number };
  /** The CSS color each frame clears to, or `null` for transparency. */
  background: string | null;
  /** The frame the scene buffered. */
  frame: SceneFrame;
}

/**
 * The renderer. One instance is built over the engine's WebGL2 context at
 * construction — shader compilation happens exactly once, and a source
 * outside the context's GLSL subset fails loudly here rather than as a black
 * picture later.
 */
export class SceneRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;

  /** Procedural uploads, keyed on the argument list, evicted oldest-first. */
  private readonly geometryCache = new Map<
    string,
    { gpu: GpuMesh; edges: GpuEdges | null }
  >();
  /** Parsed glTF documents, collected with their handles. */
  private readonly drawableCache = new WeakMap<
    MeshHandle,
    DrawableDoc | null
  >();
  /** Uploaded engine textures, collected with their handles. */
  private readonly textureCache = new WeakMap<
    TextureHandle,
    WebGLTexture | null
  >();

  private readonly streamVao: WebGLVertexArrayObject;
  private readonly streamBuffer: WebGLBuffer;
  private readonly white: WebGLTexture;
  private atlas: WebGLTexture | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = this.compile(VERTEX_SOURCE, FRAGMENT_SOURCE);
    const names = [
      "u_proj",
      "u_view",
      "u_model",
      "u_normal_matrix",
      "u_mode",
      "u_base",
      "u_emissive",
      "u_roughness",
      "u_metallic",
      "u_has_map",
      "u_map",
      "u_camera",
      "u_light_count",
      "u_light_a",
      "u_light_b",
      "u_light_range",
    ];
    this.uniforms = {};
    for (const name of names) {
      this.uniforms[name] =
        gl.getUniformLocation(this.program, name) ??
        gl.getUniformLocation(this.program, `${name}[0]`);
    }
    this.streamVao = gl.createVertexArray() as WebGLVertexArrayObject;
    this.streamBuffer = gl.createBuffer() as WebGLBuffer;
    this.white = this.uploadTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      gl.NEAREST,
      gl.CLAMP_TO_EDGE,
    );
  }

  /** Deletes everything this renderer put on the context. */
  destroy(): void {
    const gl = this.gl;
    for (const entry of this.geometryCache.values()) this.deleteGeometry(entry);
    this.geometryCache.clear();
    gl.deleteBuffer(this.streamBuffer);
    gl.deleteVertexArray(this.streamVao);
    gl.deleteTexture(this.white);
    if (this.atlas !== null) gl.deleteTexture(this.atlas);
    gl.deleteProgram(this.program);
  }

  /**
   * Draws one frame: the full-canvas clear with its depth reset (the
   * letterbox bars included), the fit pinned as viewport and scissor, the
   * command list split into runs, and the HUD composited last.
   */
  renderFrame(options: RenderFrameOptions): void {
    const gl = this.gl;
    const { viewport, surface, background, frame } = options;

    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    const clear = background === null ? [0, 0, 0, 0] : parseColor(background);
    gl.clearColor(clear[0] ?? 0, clear[1] ?? 0, clear[2] ?? 0, clear[3] ?? 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const vw = Math.round(viewport.width * viewport.scale);
    const vh = Math.round(viewport.height * viewport.scale);
    const vx = Math.round(viewport.offsetX);
    const vy = surface.height - Math.round(viewport.offsetY) - vh;
    if (vw <= 0 || vh <= 0) return;
    gl.viewport(vx, vy, vw, vh);
    gl.scissor(vx, vy, vw, vh);
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(this.program);

    let run = this.openRun(
      frame.inherited.camera,
      frame.inherited.lights,
      frame.inherited.mode,
      viewport,
    );
    let opaque: FrameCommand[] = [];
    let translucent: PendingDraw[] = [];
    const hud: FrameCommand[] = [];

    const flush = (): void => {
      this.flushRun(run, opaque, translucent);
      opaque = [];
      translucent = [];
    };

    for (const command of frame.commands) {
      if (command.kind === "setCamera") {
        flush();
        run = this.openRun(command.camera, run.lights, run.mode, viewport);
      } else if (command.kind === "setLights") {
        flush();
        run = this.openRun(
          run.camera,
          command.lights.slice(0, LIGHT_LIMIT),
          run.mode,
          viewport,
        );
      } else if (command.kind === "setMode") {
        flush();
        run = this.openRun(run.camera, run.lights, command.mode, viewport);
      } else if (command.kind === "clearDepth") {
        flush();
        // The depth clear lands inside the picture — the scissor is the fit —
        // so draws after it sit over everything drawn before it.
        gl.clearDepth(1);
        gl.clear(gl.DEPTH_BUFFER_BIT);
      } else if (command.kind === "hudText" || command.kind === "hudRect") {
        hud.push(command);
      } else {
        const position = this.drawPosition(command);
        if (this.isTranslucent(command)) {
          const dx = position.x - run.camera.position.x;
          const dy = position.y - run.camera.position.y;
          const dz = position.z - run.camera.position.z;
          translucent.push({ command, distance: Math.hypot(dx, dy, dz) });
        } else {
          opaque.push(command);
        }
      }
    }
    flush();

    // HUD draws composite last, above the 3D picture, in issue order across
    // the whole frame: no depth test, alpha blended, in logical coordinates.
    if (hud.length > 0) {
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      const hudModel = this.hudMatrix(viewport);
      gl.uniformMatrix4fv(this.uniforms["u_proj"] ?? null, false, identity4());
      gl.uniformMatrix4fv(this.uniforms["u_view"] ?? null, false, identity4());
      gl.uniformMatrix4fv(this.uniforms["u_model"] ?? null, false, hudModel);
      gl.uniformMatrix3fv(
        this.uniforms["u_normal_matrix"] ?? null,
        false,
        [1, 0, 0, 0, 1, 0, 0, 0, 1],
      );
      for (const command of hud) {
        if (command.kind === "hudRect") this.drawHudRect(command);
        else if (command.kind === "hudText") this.drawHudText(command);
      }
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Runs                                                               */
  /* ------------------------------------------------------------------ */

  private openRun(
    camera: CameraState,
    lights: readonly LightState[],
    mode: RenderMode,
    viewport: Viewport,
  ): RunState {
    const proj = perspectiveMatrix(camera, viewport.width / viewport.height);
    const view = viewMatrix(camera);
    return {
      camera,
      lights,
      mode,
      proj,
      view,
      drawable: finiteMat(proj) && finiteMat(view),
    };
  }

  /** Draws one run: its opaque draws in issue order, then its translucent draws farthest-first. */
  private flushRun(
    run: RunState,
    opaque: readonly FrameCommand[],
    translucent: PendingDraw[],
  ): void {
    if (!run.drawable || (opaque.length === 0 && translucent.length === 0))
      return;
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uniforms["u_proj"] ?? null, false, run.proj);
    gl.uniformMatrix4fv(this.uniforms["u_view"] ?? null, false, run.view);
    this.uploadLights(run);

    for (const command of opaque) this.drawWorldCommand(command, run);

    if (translucent.length > 0) {
      translucent.sort((a, b) => b.distance - a.distance);
      gl.depthMask(false);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA,
        gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
      for (const entry of translucent)
        this.drawWorldCommand(entry.command, run);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
  }

  /** The world position a draw sorts by: its transform's position, a billboard's position, a line's first point. */
  private drawPosition(command: FrameCommand): Vec3 {
    if (command.kind === "mesh" || command.kind === "geometry")
      return command.transform.position;
    if (command.kind === "billboard") return command.position;
    if (command.kind === "line")
      return command.points[0] ?? { x: 0, y: 0, z: 0 };
    return { x: 0, y: 0, z: 0 };
  }

  /** Translucent membership: opacity below one, every billboard, a line over a translucent color. */
  private isTranslucent(command: FrameCommand): boolean {
    if (command.kind === "billboard") return true;
    if (command.kind === "line") return (parseColor(command.color)[3] ?? 1) < 1;
    if (command.kind === "geometry") return command.material.opacity < 1;
    if (command.kind === "mesh") {
      if (command.material !== null) return command.material.opacity < 1;
      const doc = this.drawable(command.mesh);
      if (doc === null) return false;
      for (const primitives of doc.meshes) {
        for (const primitive of primitives)
          if (primitive.translucent) return true;
      }
      return false;
    }
    return false;
  }

  private uploadLights(run: RunState): void {
    const gl = this.gl;
    const a = new Float32Array(LIGHT_LIMIT * 4);
    const b = new Float32Array(LIGHT_LIMIT * 4);
    const range = new Float32Array(LIGHT_LIMIT);
    const count = Math.min(run.lights.length, LIGHT_LIMIT);
    for (let i = 0; i < count; i += 1) {
      const light = run.lights[i];
      if (light === undefined) continue;
      const color = parseColor(light.color);
      b[i * 4] = color[0] ?? 0;
      b[i * 4 + 1] = color[1] ?? 0;
      b[i * 4 + 2] = color[2] ?? 0;
      b[i * 4 + 3] = Number.isFinite(light.intensity) ? light.intensity : 0;
      if (light.type === "directional") {
        a[i * 4] = light.direction.x;
        a[i * 4 + 1] = light.direction.y;
        a[i * 4 + 2] = light.direction.z;
        a[i * 4 + 3] = 1;
      } else if (light.type === "point") {
        a[i * 4] = light.position.x;
        a[i * 4 + 1] = light.position.y;
        a[i * 4 + 2] = light.position.z;
        a[i * 4 + 3] = 2;
        range[i] = light.range;
      } else {
        a[i * 4 + 3] = 0;
      }
    }
    gl.uniform1i(this.uniforms["u_light_count"] ?? null, count);
    gl.uniform4fv(this.uniforms["u_light_a"] ?? null, a);
    gl.uniform4fv(this.uniforms["u_light_b"] ?? null, b);
    gl.uniform1fv(this.uniforms["u_light_range"] ?? null, range);
    gl.uniform3f(
      this.uniforms["u_camera"] ?? null,
      run.camera.position.x,
      run.camera.position.y,
      run.camera.position.z,
    );
  }

  /* ------------------------------------------------------------------ */
  /* World draws                                                        */
  /* ------------------------------------------------------------------ */

  private drawWorldCommand(command: FrameCommand, run: RunState): void {
    if (command.kind === "geometry") this.drawGeometryCommand(command, run);
    else if (command.kind === "mesh") this.drawMeshCommand(command, run);
    else if (command.kind === "billboard")
      this.drawBillboardCommand(command, run);
    else if (command.kind === "line") this.drawLineCommand(command);
  }

  private drawGeometryCommand(
    command: Extract<FrameCommand, { kind: "geometry" }>,
    run: RunState,
  ): void {
    const entry = this.geometry(command.spec);
    const model = trsMatrix(command.transform);
    if (!finiteMat(model)) return;
    const uniforms = this.materialUniforms(command.material, run.mode);
    this.setSurface(model, uniforms);
    if (run.mode === "wireframe") this.drawEdges(command.spec, entry);
    else this.drawIndexed(entry.gpu);
  }

  private drawMeshCommand(
    command: Extract<FrameCommand, { kind: "mesh" }>,
    run: RunState,
  ): void {
    const doc = this.drawable(command.mesh);
    if (doc === null) return;
    const clip =
      command.clip === null ? null : (doc.clips.get(command.clip) ?? null);
    const worlds = poseNodes(doc, clip, command.clipTime);
    const base = trsMatrix(command.transform);
    if (!finiteMat(base)) return;
    const override =
      command.material === null
        ? null
        : this.materialUniforms(command.material, run.mode);

    for (let index = 0; index < doc.nodes.length; index += 1) {
      const node = doc.nodes[index];
      const world = worlds[index];
      if (node === undefined || world === undefined || node.mesh === null)
        continue;
      const primitives = doc.meshes[node.mesh];
      if (primitives === undefined) continue;
      const model = multiply4(base, world);
      if (!finiteMat(model)) continue;
      for (const primitive of primitives) {
        const uniforms =
          override ?? this.filePrimitiveUniforms(doc, primitive, run.mode);
        this.setSurface(model, uniforms);
        if (primitive.gpu === null) primitive.gpu = this.upload(primitive);
        if (run.mode === "wireframe") {
          if (primitive.edges === null)
            primitive.edges = this.uploadEdges(
              primitive.gpu,
              primitive.indices,
            );
          this.drawLines(primitive.edges);
        } else {
          this.drawIndexed(primitive.gpu);
        }
      }
    }
  }

  private drawBillboardCommand(
    command: Extract<FrameCommand, { kind: "billboard" }>,
    run: RunState,
  ): void {
    const texture = this.texture(command.texture);
    if (texture === null) return;
    // Camera-facing: the quad spans the camera's own right and up axes, so it
    // faces the camera whatever the camera's orientation.
    const right = rotateVec3(run.camera.rotation, { x: 1, y: 0, z: 0 });
    const up = rotateVec3(run.camera.rotation, { x: 0, y: 1, z: 0 });
    const halfW = command.size.x / 2;
    const halfH = command.size.y / 2;
    const p = command.position;
    const corner = (sx: number, sy: number): [number, number, number] => [
      p.x + right.x * sx * halfW + up.x * sy * halfH,
      p.y + right.y * sx * halfW + up.y * sy * halfH,
      p.z + right.z * sx * halfW + up.z * sy * halfH,
    ];
    const tl = corner(-1, 1);
    const tr = corner(1, 1);
    const br = corner(1, -1);
    const bl = corner(-1, -1);
    // pos3 + uv2 per vertex; image row 0 is the texture's top.
    const data = Float32Array.from([
      ...tl,
      0,
      0,
      ...bl,
      0,
      1,
      ...br,
      1,
      1,
      ...tl,
      0,
      0,
      ...br,
      1,
      1,
      ...tr,
      1,
      0,
    ]);
    this.setSurface(identity4(), {
      base: [1, 1, 1, 1],
      emissive: [0, 0, 0],
      roughness: 1,
      metallic: 0,
      texture,
      mode: 1,
    });
    this.streamDraw(data, true, this.gl.TRIANGLES, 6);
  }

  private drawLineCommand(
    command: Extract<FrameCommand, { kind: "line" }>,
  ): void {
    const color = parseColor(command.color);
    const data = new Float32Array(command.points.length * 3);
    command.points.forEach((point, i) => {
      data[i * 3] = point.x;
      data[i * 3 + 1] = point.y;
      data[i * 3 + 2] = point.z;
    });
    this.setSurface(identity4(), {
      base: [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 1],
      emissive: [0, 0, 0],
      roughness: 1,
      metallic: 0,
      texture: null,
      mode: 1,
    });
    this.streamDraw(data, false, this.gl.LINE_STRIP, command.points.length);
  }

  /* ------------------------------------------------------------------ */
  /* HUD draws                                                          */
  /* ------------------------------------------------------------------ */

  /** Logical design coordinates to clip space: the top-left origin, y down. */
  private hudMatrix(viewport: Viewport): Mat4 {
    const m = identity4();
    m[0] = 2 / viewport.width;
    m[5] = -2 / viewport.height;
    m[12] = -1;
    m[13] = 1;
    return m;
  }

  private drawHudRect(
    command: Extract<FrameCommand, { kind: "hudRect" }>,
  ): void {
    const color = parseColor(command.color);
    const x0 = command.position.x;
    const y0 = command.position.y;
    const x1 = x0 + command.size.x;
    const y1 = y0 + command.size.y;
    const data = Float32Array.from([
      x0,
      y0,
      0,
      x0,
      y1,
      0,
      x1,
      y1,
      0,
      x0,
      y0,
      0,
      x1,
      y1,
      0,
      x1,
      y0,
      0,
    ]);
    this.setSurface(null, {
      base: [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 1],
      emissive: [0, 0, 0],
      roughness: 1,
      metallic: 0,
      texture: null,
      mode: 1,
    });
    this.streamDraw(data, false, this.gl.TRIANGLES, 6);
  }

  private drawHudText(
    command: Extract<FrameCommand, { kind: "hudText" }>,
  ): void {
    const color = parseColor(command.color);
    const glyphs = [...command.text];
    if (glyphs.length === 0) return;
    const advance = command.size / 2;
    const total = glyphs.length * advance;
    let x = command.position.x;
    if (command.align === "center") x -= total / 2;
    else if (command.align === "right") x -= total;
    const y = command.position.y;

    const cells = FONT_LAST_CODE_POINT - FONT_FIRST_CODE_POINT + 2;
    const data = new Float32Array(glyphs.length * 6 * 5);
    let at = 0;
    glyphs.forEach((glyph, i) => {
      const code = glyph.codePointAt(0) ?? 0;
      const cell =
        code >= FONT_FIRST_CODE_POINT && code <= FONT_LAST_CODE_POINT
          ? code - FONT_FIRST_CODE_POINT
          : cells - 1;
      const u0 = cell / cells;
      const u1 = (cell + 1) / cells;
      const x0 = x + i * advance;
      const x1 = x0 + advance;
      const y1 = y + command.size;
      const quad = [
        x0,
        y,
        0,
        u0,
        0,
        x0,
        y1,
        0,
        u0,
        1,
        x1,
        y1,
        0,
        u1,
        1,
        x0,
        y,
        0,
        u0,
        0,
        x1,
        y1,
        0,
        u1,
        1,
        x1,
        y,
        0,
        u1,
        0,
      ];
      data.set(quad, at);
      at += quad.length;
    });

    this.setSurface(null, {
      base: [color[0] ?? 0, color[1] ?? 0, color[2] ?? 0, color[3] ?? 1],
      emissive: [0, 0, 0],
      roughness: 1,
      metallic: 0,
      texture: this.fontAtlas(),
      mode: 1,
    });
    this.streamDraw(data, true, this.gl.TRIANGLES, glyphs.length * 6);
  }

  /**
   * The glyph atlas: every covered glyph plus the replacement box, one cell
   * apiece, rasterized once from the package's own Unscii 16 data as a white
   * alpha mask the text color multiplies.
   */
  private fontAtlas(): WebGLTexture {
    if (this.atlas !== null) return this.atlas;
    const cells = FONT_LAST_CODE_POINT - FONT_FIRST_CODE_POINT + 2;
    const width = cells * FONT_CELL_WIDTH;
    const pixels = new Uint8Array(width * FONT_CELL_HEIGHT * 4);
    for (let cell = 0; cell < cells; cell += 1) {
      // The final cell letters the replacement box: any out-of-coverage code
      // point answers it, so one past the last covered point is exactly it.
      const code =
        cell < cells - 1
          ? FONT_FIRST_CODE_POINT + cell
          : FONT_LAST_CODE_POINT + 1;
      const rows = glyphRows(code);
      for (let row = 0; row < FONT_CELL_HEIGHT; row += 1) {
        const bits = rows[row] ?? 0;
        for (let col = 0; col < FONT_CELL_WIDTH; col += 1) {
          if ((bits & (0x80 >> col)) === 0) continue;
          const px = (row * width + cell * FONT_CELL_WIDTH + col) * 4;
          pixels[px] = 255;
          pixels[px + 1] = 255;
          pixels[px + 2] = 255;
          pixels[px + 3] = 255;
        }
      }
    }
    this.atlas = this.uploadTexture(
      pixels,
      width,
      FONT_CELL_HEIGHT,
      this.gl.NEAREST,
      this.gl.CLAMP_TO_EDGE,
    );
    return this.atlas;
  }

  /* ------------------------------------------------------------------ */
  /* Uniforms and materials                                             */
  /* ------------------------------------------------------------------ */

  /** The shading figures of a resolved engine material under the run's mode. */
  private materialUniforms(
    material: ResolvedMaterial,
    mode: RenderMode,
  ): SurfaceUniforms {
    const base = parseColor(material.baseColor);
    const emissive = parseColor(material.emissive);
    const texture =
      material.baseColorMap === null
        ? null
        : this.texture(material.baseColorMap);
    return {
      base: [
        base[0] ?? 0,
        base[1] ?? 0,
        base[2] ?? 0,
        (base[3] ?? 1) * material.opacity,
      ],
      emissive: [emissive[0] ?? 0, emissive[1] ?? 0, emissive[2] ?? 0],
      roughness: material.roughness,
      metallic: material.metallic,
      texture,
      // Wireframe letters its lines flat in the base color — lighting a line
      // has no surface to shade — and normals wins over an unlit material
      // because the mode is a whole-scene diagnostic.
      mode:
        mode === "normals"
          ? 2
          : mode === "unlit" || mode === "wireframe" || material.unlit
            ? 1
            : 0,
    };
  }

  /** The shading figures of a glTF primitive's own file material under the run's mode. */
  private filePrimitiveUniforms(
    doc: DrawableDoc,
    primitive: DrawablePrimitive,
    mode: RenderMode,
  ): SurfaceUniforms {
    let texture: WebGLTexture | null = null;
    if (primitive.texture !== null) {
      const entry = doc.textures[primitive.texture];
      if (entry !== null && entry !== undefined) {
        if (entry.gpu === null) {
          entry.gpu = this.uploadTexture(
            entry.pixels,
            entry.width,
            entry.height,
            this.gl.LINEAR,
            this.gl.REPEAT,
          );
        }
        texture = entry.gpu;
      }
    }
    return {
      base: primitive.baseColor,
      emissive: primitive.emissive,
      roughness: primitive.roughness,
      metallic: primitive.metallic,
      texture,
      mode:
        mode === "normals"
          ? 2
          : mode === "unlit" || mode === "wireframe"
            ? 1
            : 0,
    };
  }

  /** Sets the per-draw uniforms; `model: null` keeps whatever model/normal matrices are in force (the HUD pass). */
  private setSurface(model: Mat4 | null, uniforms: SurfaceUniforms): void {
    const gl = this.gl;
    if (model !== null) {
      gl.uniformMatrix4fv(this.uniforms["u_model"] ?? null, false, model);
      gl.uniformMatrix3fv(
        this.uniforms["u_normal_matrix"] ?? null,
        false,
        normalMatrix(model),
      );
    }
    gl.uniform1i(this.uniforms["u_mode"] ?? null, uniforms.mode);
    gl.uniform4f(
      this.uniforms["u_base"] ?? null,
      uniforms.base[0],
      uniforms.base[1],
      uniforms.base[2],
      uniforms.base[3],
    );
    gl.uniform3f(
      this.uniforms["u_emissive"] ?? null,
      uniforms.emissive[0],
      uniforms.emissive[1],
      uniforms.emissive[2],
    );
    gl.uniform1f(
      this.uniforms["u_roughness"] ?? null,
      clamp01(uniforms.roughness),
    );
    gl.uniform1f(
      this.uniforms["u_metallic"] ?? null,
      clamp01(uniforms.metallic),
    );
    gl.uniform1i(
      this.uniforms["u_has_map"] ?? null,
      uniforms.texture === null ? 0 : 1,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, uniforms.texture ?? this.white);
    gl.uniform1i(this.uniforms["u_map"] ?? null, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Uploads and caches                                                 */
  /* ------------------------------------------------------------------ */

  private compile(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const stage = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
        const log = gl.getShaderInfoLog(shader) ?? "";
        throw new Error(
          `simple-3d: an engine shader failed to compile, which is a bug in the engine: ${log}`,
        );
      }
      return shader;
    };
    const vertex = stage(gl.VERTEX_SHADER, vertexSource);
    const fragment = stage(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
      const log = gl.getProgramInfoLog(program) ?? "";
      throw new Error(
        `simple-3d: the engine's shader program failed to link, which is a bug in the engine: ${log}`,
      );
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return program;
  }

  private uploadTexture(
    pixels: Uint8Array,
    width: number,
    height: number,
    filter: number,
    wrap: number,
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture() as WebGLTexture;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    // Non-mip filters at base level, always: nothing here mipmaps (decision
    // recorded in the engine plan), and the default minifying filter would.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return texture;
  }

  /** The uploaded texture behind an engine handle, or `null` for a value this engine never loaded. */
  private texture(handle: TextureHandle): WebGLTexture | null {
    const known = this.textureCache.get(handle);
    if (known !== undefined) return known;
    const source = textureSource(handle);
    const texture =
      source === undefined
        ? null
        : this.uploadTexture(
            source.pixels,
            source.width,
            source.height,
            this.gl.LINEAR,
            this.gl.CLAMP_TO_EDGE,
          );
    this.textureCache.set(handle, texture);
    return texture;
  }

  private drawable(handle: MeshHandle): DrawableDoc | null {
    const known = this.drawableCache.get(handle);
    if (known !== undefined) return known;
    let doc: DrawableDoc | null;
    try {
      doc = parseDrawable(handle);
    } catch {
      doc = null;
    }
    this.drawableCache.set(handle, doc);
    return doc;
  }

  private upload(data: {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array | null;
    indices: Uint32Array;
  }): GpuMesh {
    const gl = this.gl;
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    const buffers: WebGLBuffer[] = [];
    const attrib = (
      index: number,
      size: number,
      values: Float32Array,
    ): void => {
      const buffer = gl.createBuffer() as WebGLBuffer;
      buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index, size, gl.FLOAT, false, 0, 0);
    };
    attrib(0, 3, data.positions);
    attrib(1, 3, data.normals);
    if (data.uvs !== null) attrib(2, 2, data.uvs);
    const indexBuffer = gl.createBuffer() as WebGLBuffer;
    buffers.push(indexBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, buffers, count: data.indices.length };
  }

  private uploadEdges(gpu: GpuMesh, indices: Uint32Array): GpuEdges {
    const gl = this.gl;
    const edges = edgeIndices(indices);
    const vao = gl.createVertexArray() as WebGLVertexArrayObject;
    gl.bindVertexArray(vao);
    // The edge VAO shares the body's position buffer — the first one the
    // upload created — and leaves the other attributes to their generic
    // values, so a wireframe costs one index buffer, not a second body.
    const position = gpu.buffers[0];
    if (position !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    }
    const buffer = gl.createBuffer() as WebGLBuffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, buffer, count: edges.length };
  }

  /** A procedural body's upload, keyed on its argument list and bounded. */
  private geometry(spec: GeometrySpec): {
    gpu: GpuMesh;
    edges: GpuEdges | null;
  } {
    const key = JSON.stringify(spec);
    const known = this.geometryCache.get(key);
    if (known !== undefined) return known;
    const entry = { gpu: this.upload(buildGeometry(spec)), edges: null };
    if (this.geometryCache.size >= GEOMETRY_CACHE_LIMIT) {
      const oldest = this.geometryCache.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.geometryCache.get(oldest);
        if (evicted !== undefined) this.deleteGeometry(evicted);
        this.geometryCache.delete(oldest);
      }
    }
    this.geometryCache.set(key, entry);
    return entry;
  }

  private deleteGeometry(entry: {
    gpu: GpuMesh;
    edges: GpuEdges | null;
  }): void {
    const gl = this.gl;
    for (const buffer of entry.gpu.buffers) gl.deleteBuffer(buffer);
    gl.deleteVertexArray(entry.gpu.vao);
    if (entry.edges !== null) {
      gl.deleteBuffer(entry.edges.buffer);
      gl.deleteVertexArray(entry.edges.vao);
    }
  }

  private drawEdges(
    spec: GeometrySpec,
    entry: { gpu: GpuMesh; edges: GpuEdges | null },
  ): void {
    if (entry.edges === null) {
      entry.edges = this.uploadEdges(entry.gpu, buildGeometry(spec).indices);
    }
    this.drawLines(entry.edges);
  }

  private drawIndexed(gpu: GpuMesh): void {
    const gl = this.gl;
    gl.bindVertexArray(gpu.vao);
    this.defaultAttribs();
    gl.drawElements(gl.TRIANGLES, gpu.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private drawLines(edges: GpuEdges): void {
    const gl = this.gl;
    gl.bindVertexArray(edges.vao);
    this.defaultAttribs();
    gl.drawElements(gl.LINES, edges.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /** Streams one dynamic body through the shared buffer: `textured` interleaves pos3+uv2, otherwise pos3 alone. */
  private streamDraw(
    data: Float32Array,
    textured: boolean,
    mode: number,
    count: number,
  ): void {
    const gl = this.gl;
    gl.bindVertexArray(this.streamVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.streamBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    const stride = textured ? 20 : 12;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    if (textured) {
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 12);
    } else {
      gl.disableVertexAttribArray(2);
    }
    gl.disableVertexAttribArray(1);
    this.defaultAttribs();
    gl.drawArrays(mode, 0, count);
    gl.bindVertexArray(null);
  }

  /** The generic values a disabled attribute reads: a +Z normal and a zero UV. */
  private defaultAttribs(): void {
    this.gl.vertexAttrib3f(1, 0, 0, 1);
    this.gl.vertexAttrib2f(2, 0, 0);
  }
}

/** Clamps a shading figure into `0..1`, the range the shader assumes. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
