/**
 * The rendering pipeline and the WebGL2 back end: the engine owns drawing.
 *
 * A game configures what to draw by attaching render components to its actors,
 * and the pipeline collects them, orders them, and draws them once per frame
 * through the engine-owned scene context — the shared vocabulary Simple 3D
 * specifies, so both engines' recordings replay in one player. Everything here
 * mirrors `docs/engines/structured-3d/apis/rendering.md`,
 * `concepts/rendering.md`, `usage/rendering.md`, and — for the scene-context
 * vocabulary — `docs/engines/simple-3d/apis/game.md`; those pages are the
 * specification, and behavior that disagrees with them is wrong.
 *
 * Five decisions shape the module, and each is what makes a later property
 * true:
 *
 * 1. **One scene context for the engine's life, and everything draws through
 *    it.** The built-in components, the collision overlay, and a
 *    `DrawComponent`'s `api.scene` all issue the same ten-verb vocabulary
 *    against the same object, so the recorder wraps one seam and the whole
 *    picture is inside it. The per-layer depth clears and the overlay's clear
 *    lower onto `clearDepth`, a vocabulary verb, so a recording carries them
 *    and a replayed frame reproduces the HUD idiom exactly.
 * 2. **Component conveniences lower onto the vocabulary rather than beside
 *    it.** A `TextComponent` rasterizes to a `text:`-pathed texture and issues
 *    `drawBillboard` (a `drawLine` outline under `wireframe`); a
 *    `ShapeComponent` creates its geometry through the producers with the
 *    documented scale rules already applied; tint and component opacity fold
 *    into the material argument. Nothing reaches the pixels except through a
 *    recorded call.
 * 3. **The renderer draws directly against WebGL2, inside the documented GLSL
 *    subset.** Two fixed programs cover every draw — a scene program whose
 *    shade selector spans standard/unlit/normals/flat, and a HUD program in
 *    device space — and every shader stays inside
 *    `packages/headless-webgl2/docs/glsl-subset.md`, so the same sources
 *    compile on the in-process rasterizer and on real drivers.
 * 4. **Translucency is a property of the run.** The state setters and
 *    `clearDepth` divide a frame into runs; translucent draws — a material
 *    below opacity 1, every billboard, a line over a translucent color —
 *    defer and render after their run's opaque draws, farthest-first from the
 *    run's camera, ties by issue order. HUD draws composite last, above the
 *    3D picture, in issue order across the whole frame.
 * 5. **The pipeline never reads a pixel and never keeps one.** The picture is
 *    a function of the world at the moment the pipeline runs — the stable
 *    layer/spawn/attachment sort, the snapshot light list, the pure clip
 *    pose — which is what lets a validator read a pixel back and assert on
 *    it, and two runs of one scenario produce the same picture.
 */

import type { Actor } from "./actors";
import {
  decodedMesh,
  decodedTexture,
  type DecodedGlb,
  type GlbAccessor,
  type GlbBufferView,
  type GlbNode,
  type MaterialHandle,
  type MeshHandle,
  type TextureHandle,
} from "./assets";
import {
  CameraComponent,
  DrawComponent,
  LightComponent,
  MeshComponent,
  RenderComponent,
  ShapeComponent,
  TextComponent,
  defaultLightRig,
  lightStateOf,
  scaleShape3,
  textHeightOf,
  type DrawApi,
  type DrawMeshOptions,
  type Geometry,
  type HudTextOptions,
  type Material,
  type MaterialLike,
  type MaterialSpec,
  type SceneContext,
  type Shape3,
} from "./components";
import type {
  Color,
  LightState,
  MaterialMapSlot,
  RenderMode,
} from "./contract";
import { FONT_CELL_HEIGHT, FONT_CELL_WIDTH, glyphRows } from "./font";
import type {
  Box3,
  CameraState,
  Quat,
  Transform,
  Vec2,
  Vec3,
  Viewport,
} from "./math";
import { rotateVec3 } from "./math";
import { decodePng, type DecodedPng } from "./png";
import {
  SceneRecorder,
  type FrameFigures,
  type HandleCapturePayload,
  type HandleDescription,
} from "./recording";
import type { FrameInfo } from "./worlds";

/* -------------------------------------------------------------------------- */
/* CSS colors                                                                 */
/* -------------------------------------------------------------------------- */

/** A parsed color: components in `0..1`, alpha included. */
export type Rgba = readonly [number, number, number, number];

/**
 * The named colors the parser recognizes: the CSS basic palette plus the few
 * synonyms doc examples use. A renderer with no DOM has no `<canvas>` to
 * delegate parsing to, so the subset is fixed here; anything else is written
 * as hex or `rgb()`/`hsl()` in practice.
 */
const NAMED_COLORS: Readonly<Record<string, Rgba>> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  red: [1, 0, 0, 1],
  lime: [0, 1, 0, 1],
  green: [0, 128 / 255, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  aqua: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
  fuchsia: [1, 0, 1, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  silver: [192 / 255, 192 / 255, 192 / 255, 1],
  maroon: [128 / 255, 0, 0, 1],
  olive: [128 / 255, 128 / 255, 0, 1],
  navy: [0, 0, 128 / 255, 1],
  teal: [0, 128 / 255, 128 / 255, 1],
  purple: [128 / 255, 0, 128 / 255, 1],
  orange: [1, 165 / 255, 0, 1],
};

/** One `hsl()` channel triple to rgb, hue in degrees. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}

/** One functional-notation argument: a plain number, or a percentage of `full`. */
function channel(token: string, full: number): number {
  const trimmed = token.trim();
  if (trimmed.endsWith("%")) return (Number(trimmed.slice(0, -1)) / 100) * full;
  return Number(trimmed);
}

/**
 * A CSS color as the renderer reads it. Hex (3/4/6/8 digits), `rgb()`/`rgba()`,
 * `hsl()`/`hsla()`, and the named subset above; anything unreadable answers
 * opaque white — the same forgiving fallback the component defaults use — so a
 * typo in a color field draws a visible surface rather than killing the frame.
 */
export function parseColor(css: string): Rgba {
  const text = css.trim().toLowerCase();
  const named = NAMED_COLORS[text];
  if (named !== undefined) return named;
  if (text.startsWith("#")) {
    const hex = text.slice(1);
    if (/^[0-9a-f]+$/.test(hex)) {
      if (hex.length === 3 || hex.length === 4) {
        const parts = hex.split("").map((d) => parseInt(d + d, 16) / 255);
        return [parts[0] ?? 1, parts[1] ?? 1, parts[2] ?? 1, parts[3] ?? 1];
      }
      if (hex.length === 6 || hex.length === 8) {
        const parts: number[] = [];
        for (let i = 0; i < hex.length; i += 2) {
          parts.push(parseInt(hex.slice(i, i + 2), 16) / 255);
        }
        return [parts[0] ?? 1, parts[1] ?? 1, parts[2] ?? 1, parts[3] ?? 1];
      }
    }
    return [1, 1, 1, 1];
  }
  const call = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text);
  if (call !== null) {
    const args = (call[2] ?? "")
      .replace(/\//g, " ")
      .split(/[\s,]+/)
      .filter((part) => part.length > 0);
    if (args.length >= 3) {
      const alpha = args.length >= 4 ? channel(args[3] ?? "1", 1) : 1;
      if ((call[1] ?? "").startsWith("rgb")) {
        return [
          clamp01(channel(args[0] ?? "0", 255) / 255),
          clamp01(channel(args[1] ?? "0", 255) / 255),
          clamp01(channel(args[2] ?? "0", 255) / 255),
          clamp01(alpha),
        ];
      }
      const h = Number((args[0] ?? "0").replace(/deg$/, ""));
      const s = clamp01(channel(args[1] ?? "0", 1));
      const l = clamp01(channel(args[2] ?? "0", 1));
      const [r, g, b] = hslToRgb(h, s, l);
      return [clamp01(r), clamp01(g), clamp01(b), clamp01(alpha)];
    }
  }
  return [1, 1, 1, 1];
}

/** `value` clamped into `0..1`, with non-finite values falling to the near end. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0), 1);
}

/** Opacity as the pipeline applies it: clamped to `0..1` at the draw. */
function clampOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 1;
  return Math.min(Math.max(opacity, 0), 1);
}

/* -------------------------------------------------------------------------- */
/* PNG encoding                                                               */
/* -------------------------------------------------------------------------- */

/** The CRC-32 table, built once. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0xffffffff;
  for (let i = from; i < to; i++) {
    crc = CRC_TABLE[(crc ^ (bytes[i] ?? 0)) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * RGBA8 pixels as a PNG file: 8-bit color type 6, filter 0 rows, and a zlib
 * stream of stored (uncompressed) deflate blocks.
 *
 * Stored blocks rather than a real compressor, because the encoder exists for
 * asset capture — where gzip wraps the whole recording anyway, so compressing
 * inside the PNG would spend a deflate implementation to shrink bytes a second
 * compressor already covers. The output is a valid PNG every decoder reads,
 * this package's own `decodePng` included.
 */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  const stride = width * 4 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * stride + 1);
  }

  // zlib envelope: header, stored blocks of at most 65535 bytes, adler32.
  const blockCount = Math.max(1, Math.ceil(raw.length / 65535));
  const idat = new Uint8Array(2 + raw.length + blockCount * 5 + 4);
  idat[0] = 0x78;
  idat[1] = 0x01;
  let at = 2;
  for (let offset = 0; offset < raw.length || offset === 0; offset += 65535) {
    const size = Math.min(65535, raw.length - offset);
    const final = offset + size >= raw.length ? 1 : 0;
    idat[at] = final;
    idat[at + 1] = size & 0xff;
    idat[at + 2] = (size >> 8) & 0xff;
    idat[at + 3] = ~size & 0xff;
    idat[at + 4] = (~size >> 8) & 0xff;
    idat.set(raw.subarray(offset, offset + size), at + 5);
    at += 5 + size;
    if (final === 1) break;
  }
  let a = 1;
  let b = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + (raw[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  idat[at] = (b >> 8) & 0xff;
  idat[at + 1] = b & 0xff;
  idat[at + 2] = (a >> 8) & 0xff;
  idat[at + 3] = a & 0xff;
  const idatLength = at + 4;

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const out = new Uint8Array(8 + (12 + 13) + (12 + idatLength) + 12);
  const view = new DataView(out.buffer);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let cursor = 8;
  const chunk = (type: string, body: Uint8Array): void => {
    view.setUint32(cursor, body.length);
    for (let i = 0; i < 4; i++) out[cursor + 4 + i] = type.charCodeAt(i);
    out.set(body, cursor + 8);
    const crc = crc32(out, cursor + 4, cursor + 8 + body.length);
    view.setUint32(cursor + 8 + body.length, crc);
    cursor += 12 + body.length;
  };
  chunk("IHDR", ihdr);
  chunk("IDAT", idat.subarray(0, idatLength));
  chunk("IEND", new Uint8Array(0));
  return out;
}

/* -------------------------------------------------------------------------- */
/* glTF binary re-encoding                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A `DecodedGlb`'s chunks back as a glTF binary container — what a mesh
 * capture carries, since the asset loader keeps the parsed chunks rather than
 * the original file bytes. The JSON chunk is padded with spaces and the binary
 * chunk with zeros to the 4-byte alignment the container requires, so the
 * output is a valid `.glb` every loader reads; it is the same document even
 * where it is not the same bytes.
 */
export function encodeGlb(glb: DecodedGlb): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(glb.json));
  const jsonPadded = (jsonBytes.length + 3) & ~3;
  const binPadded = (glb.bin.length + 3) & ~3;
  const hasBin = glb.bin.length > 0;
  const total = 12 + 8 + jsonPadded + (hasBin ? 8 + binPadded : 0);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  if (hasBin) {
    const binStart = 20 + jsonPadded;
    view.setUint32(binStart, binPadded, true);
    view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
    out.set(glb.bin, binStart + 8);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Text rasterization                                                         */
/* -------------------------------------------------------------------------- */

/** Decoded pixels behind a texture the engine rasterized itself. */
const RASTERIZED_PIXELS = new WeakMap<object, DecodedPng>();

/**
 * A texture the engine rasterized itself — a `TextComponent`'s billboard.
 * Structurally a `TextureHandle` whose `path` is `text:` followed by the
 * string, which is exactly how its capture appears in a recording, so a player
 * draws the lettering from the captured pixels without owning the face.
 */
class RasterizedTexture implements TextureHandle {
  readonly path: string;
  readonly width: number;
  readonly height: number;

  constructor(path: string, pixels: DecodedPng) {
    this.path = path;
    this.width = pixels.width;
    this.height = pixels.height;
    RASTERIZED_PIXELS.set(this, pixels);
  }
}

/**
 * A string lettered in the engine's monospace face — Unscii 16, the 8×16
 * glyph data `font.ts` carries — as RGBA pixels: `rgb` everywhere, alpha
 * `alphaByte` where a glyph bit is set and `0` elsewhere. One cell per code
 * point, so the pixel width is half the height per character and the quad's
 * world aspect matches for free.
 */
function rasterizeText(
  text: string,
  rgb: readonly [number, number, number],
  alphaByte: number,
): DecodedPng {
  const chars = [...text];
  const width = Math.max(1, chars.length * FONT_CELL_WIDTH);
  const height = FONT_CELL_HEIGHT;
  const pixels = new Uint8Array(width * height * 4);
  const r = Math.round(clamp01(rgb[0]) * 255);
  const g = Math.round(clamp01(rgb[1]) * 255);
  const b = Math.round(clamp01(rgb[2]) * 255);
  for (let i = 0; i < chars.length; i++) {
    const rows = glyphRows(chars[i]?.codePointAt(0) ?? 0);
    for (let y = 0; y < FONT_CELL_HEIGHT; y++) {
      const bits = rows[y] ?? 0;
      for (let x = 0; x < FONT_CELL_WIDTH; x++) {
        if ((bits & (0x80 >> x)) === 0) continue;
        const at = (y * width + i * FONT_CELL_WIDTH + x) * 4;
        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
        pixels[at + 3] = alphaByte;
      }
    }
  }
  return { width, height, pixels };
}

/**
 * A small least-recently-used cache. Bounded, because the engine holds
 * nothing that grows with the length of a run: a scoreboard that letters a
 * new string every frame cycles the cache rather than growing it, and a
 * re-rasterized string dedups in a recording on its content either way.
 */
class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Refresh recency: a Map iterates in insertion order, so re-inserting
      // moves the key to the young end.
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Matrices                                                                   */
/* -------------------------------------------------------------------------- */

/** Column-major 4×4, the layout `uniformMatrix4fv` takes. */
type Mat4 = Float64Array;

function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** TRS composition: scale, then rotation, then translation. */
function mat4FromTrs(position: Vec3, rotation: Quat, scale: Vec3): Mat4 {
  const { x, y, z, w } = rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m = new Float64Array(16);
  m[0] = (1 - (yy + zz)) * scale.x;
  m[1] = (xy + wz) * scale.x;
  m[2] = (xz - wy) * scale.x;
  m[4] = (xy - wz) * scale.y;
  m[5] = (1 - (xx + zz)) * scale.y;
  m[6] = (yz + wx) * scale.y;
  m[8] = (xz + wy) * scale.z;
  m[9] = (yz - wx) * scale.z;
  m[10] = (1 - (xx + yy)) * scale.z;
  m[12] = position.x;
  m[13] = position.y;
  m[14] = position.z;
  m[15] = 1;
  return m;
}

/** The camera's view matrix: rotate by the conjugate, then translate by −position. */
function mat4View(camera: CameraState): Mat4 {
  const conj: Quat = {
    x: -camera.rotation.x,
    y: -camera.rotation.y,
    z: -camera.rotation.z,
    w: camera.rotation.w,
  };
  const rotate = mat4FromTrs({ x: 0, y: 0, z: 0 }, conj, { x: 1, y: 1, z: 1 });
  const translate = mat4Identity();
  translate[12] = -camera.position.x;
  translate[13] = -camera.position.y;
  translate[14] = -camera.position.z;
  return mat4Multiply(rotate, translate);
}

/** The perspective projection over the design aspect — the only y flip is the camera page's NDC step. */
function mat4Perspective(
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** The inverse-transpose of the model's upper 3×3 — the normal matrix, non-uniform scale included. */
function normalMatrix(model: Mat4): Float32Array {
  const a = model[0] ?? 0;
  const b = model[1] ?? 0;
  const c = model[2] ?? 0;
  const d = model[4] ?? 0;
  const e = model[5] ?? 0;
  const f = model[6] ?? 0;
  const g = model[8] ?? 0;
  const h = model[9] ?? 0;
  const i = model[10] ?? 0;
  const det = a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  const invDet = det === 0 ? 0 : 1 / det;
  // The inverse's rows are the cofactor columns over the determinant; the
  // transpose of that inverse is written straight into column-major order.
  const out = new Float32Array(9);
  out[0] = (e * i - f * h) * invDet;
  out[1] = (f * g - d * i) * invDet;
  out[2] = (d * h - e * g) * invDet;
  out[3] = (c * h - b * i) * invDet;
  out[4] = (a * i - c * g) * invDet;
  out[5] = (b * g - a * h) * invDet;
  out[6] = (b * f - c * e) * invDet;
  out[7] = (c * d - a * f) * invDet;
  out[8] = (a * e - b * d) * invDet;
  return out;
}

function mat4ToFloat32(m: Mat4): Float32Array {
  return Float32Array.from(m);
}

/* -------------------------------------------------------------------------- */
/* Procedural geometry                                                        */
/* -------------------------------------------------------------------------- */

/** One renderable triangle soup with the attributes the scene program binds. */
interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  /** Skinning attributes, present for glTF primitives with a skin. */
  joints?: Float32Array;
  weights?: Float32Array;
}

/** The unique undirected triangle edges, for the wireframe mode's lines. */
function edgeIndices(indices: Uint32Array): Uint32Array {
  const seen = new Set<number>();
  const out: number[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const tri = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
    for (let e = 0; e < 3; e++) {
      const a = tri[e] ?? 0;
      const b = tri[(e + 1) % 3] ?? 0;
      const key = a < b ? a * 0x100000000 + b : b * 0x100000000 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a, b);
    }
  }
  return Uint32Array.from(out);
}

/** A lat/long band mesh over a profile of rings — the shared body of sphere, cylinder, and capsule. */
function latheRings(
  rings: readonly {
    y: number;
    radius: number;
    ny: number;
    nr: number;
    v: number;
  }[],
  segments: number,
): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const columns = segments + 1;
  for (const ring of rings) {
    for (let s = 0; s <= segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(ring.radius * cos, ring.y, ring.radius * sin);
      const nx = ring.nr * cos;
      const nz = ring.nr * sin;
      const len = Math.hypot(nx, ring.ny, nz) || 1;
      normals.push(nx / len, ring.ny / len, nz / len);
      uvs.push(s / segments, ring.v);
    }
  }
  for (let r = 0; r + 1 < rings.length; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * columns + s;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

function buildBox(size: Vec3): MeshData {
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  // Six faces, four vertices each, with per-face normals and 0..1 UVs.
  const faces: { n: Vec3; corners: Vec3[] }[] = [
    {
      n: { x: 0, y: 0, z: 1 },
      corners: [
        { x: -hx, y: -hy, z: hz },
        { x: hx, y: -hy, z: hz },
        { x: hx, y: hy, z: hz },
        { x: -hx, y: hy, z: hz },
      ],
    },
    {
      n: { x: 0, y: 0, z: -1 },
      corners: [
        { x: hx, y: -hy, z: -hz },
        { x: -hx, y: -hy, z: -hz },
        { x: -hx, y: hy, z: -hz },
        { x: hx, y: hy, z: -hz },
      ],
    },
    {
      n: { x: 1, y: 0, z: 0 },
      corners: [
        { x: hx, y: -hy, z: hz },
        { x: hx, y: -hy, z: -hz },
        { x: hx, y: hy, z: -hz },
        { x: hx, y: hy, z: hz },
      ],
    },
    {
      n: { x: -1, y: 0, z: 0 },
      corners: [
        { x: -hx, y: -hy, z: -hz },
        { x: -hx, y: -hy, z: hz },
        { x: -hx, y: hy, z: hz },
        { x: -hx, y: hy, z: -hz },
      ],
    },
    {
      n: { x: 0, y: 1, z: 0 },
      corners: [
        { x: -hx, y: hy, z: hz },
        { x: hx, y: hy, z: hz },
        { x: hx, y: hy, z: -hz },
        { x: -hx, y: hy, z: -hz },
      ],
    },
    {
      n: { x: 0, y: -1, z: 0 },
      corners: [
        { x: -hx, y: -hy, z: -hz },
        { x: hx, y: -hy, z: -hz },
        { x: hx, y: -hy, z: hz },
        { x: -hx, y: -hy, z: hz },
      ],
    },
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [f, face] of faces.entries()) {
    for (const [i, corner] of face.corners.entries()) {
      positions.push(corner.x, corner.y, corner.z);
      normals.push(face.n.x, face.n.y, face.n.z);
      uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
    }
    const base = f * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

/** 32×16 segments — the documented sphere tessellation. */
function buildSphere(radius: number): MeshData {
  const rings: {
    y: number;
    radius: number;
    ny: number;
    nr: number;
    v: number;
  }[] = [];
  for (let r = 0; r <= 16; r++) {
    const lat = (r / 16) * Math.PI - Math.PI / 2;
    rings.push({
      y: radius * Math.sin(lat),
      radius: radius * Math.cos(lat),
      ny: Math.sin(lat),
      nr: Math.cos(lat),
      v: r / 16,
    });
  }
  return latheRings(rings, 32);
}

/** A capped cylinder, 32 radial segments, on the local Y axis. */
function buildCylinder(radius: number, height: number): MeshData {
  const h = height / 2;
  const side = latheRings(
    [
      { y: -h, radius, ny: 0, nr: 1, v: 0 },
      { y: h, radius, ny: 0, nr: 1, v: 1 },
    ],
    32,
  );
  const cap = (y: number, ny: number): MeshData =>
    latheRings(
      ny > 0
        ? [
            { y, radius, ny, nr: 0, v: 0 },
            { y, radius: 0, ny, nr: 0, v: 1 },
          ]
        : [
            { y, radius: 0, ny, nr: 0, v: 0 },
            { y, radius, ny, nr: 0, v: 1 },
          ],
      32,
    );
  return mergeMeshData([side, cap(h, 1), cap(-h, -1)]);
}

/** A capsule: 32 radial segments, each hemispherical cap 8 rings, on the local Y axis. */
function buildCapsule(radius: number, height: number): MeshData {
  const h = height / 2;
  const rings: {
    y: number;
    radius: number;
    ny: number;
    nr: number;
    v: number;
  }[] = [];
  const total = 8 + 1 + 8;
  let row = 0;
  for (let r = 0; r <= 8; r++, row++) {
    const lat = (r / 8) * (Math.PI / 2) - Math.PI / 2;
    rings.push({
      y: -h + radius * Math.sin(lat),
      radius: radius * Math.cos(lat),
      ny: Math.sin(lat),
      nr: Math.cos(lat),
      v: row / total,
    });
  }
  row++; // the straight side spans one v step
  for (let r = 0; r <= 8; r++) {
    const lat = (r / 8) * (Math.PI / 2);
    rings.push({
      y: h + radius * Math.sin(lat),
      radius: radius * Math.cos(lat),
      ny: Math.sin(lat),
      nr: Math.cos(lat),
      v: (row + r) / total,
    });
  }
  return latheRings(rings, 32);
}

/** A width×depth plane on the local XZ plane, +Y normal, centered. */
function buildPlane(width: number, depth: number): MeshData {
  const hw = width / 2;
  const hd = depth / 2;
  return {
    positions: Float32Array.from([
      -hw,
      0,
      -hd,
      hw,
      0,
      -hd,
      hw,
      0,
      hd,
      -hw,
      0,
      hd,
    ]),
    normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: Uint32Array.from([0, 2, 1, 0, 3, 2]),
  };
}

function mergeMeshData(parts: readonly MeshData[]): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let base = 0;
  for (const part of parts) {
    positions.push(...part.positions);
    normals.push(...part.normals);
    uvs.push(...part.uvs);
    for (const index of part.indices) indices.push(index + base);
    base += part.positions.length / 3;
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    uvs: Float32Array.from(uvs),
    indices: Uint32Array.from(indices),
  };
}

/**
 * Shared mesh data per producing call. Two `createBox({x:1,y:1,z:1})` calls
 * share one tessellation and therefore one set of GPU buffers, which is what
 * makes the documented per-frame-creation idiom cost nothing on this side
 * either. Bounded, because a build sweeping a parameter every frame must not
 * grow the engine.
 */
const MESH_DATA_CACHE = new LruCache<MeshData>(512);

function cachedMeshData(key: string, build: () => MeshData): MeshData {
  const found = MESH_DATA_CACHE.get(key);
  if (found !== undefined) return found;
  const built = build();
  MESH_DATA_CACHE.set(key, built);
  return built;
}

/* -------------------------------------------------------------------------- */
/* Produced values                                                            */
/* -------------------------------------------------------------------------- */

/**
 * An engine-owned, immutable procedural geometry — what the six `create*`
 * producers return. `bounds` is the documented axis-aligned local bounds;
 * the tessellation is shared through {@link MESH_DATA_CACHE}.
 */
class EngineGeometry implements Geometry {
  readonly bounds: Box3;

  constructor(
    /** The tessellation the renderer binds. */
    readonly data: MeshData,
    bounds: Box3,
  ) {
    this.bounds = Object.freeze({
      min: Object.freeze({ ...bounds.min }),
      max: Object.freeze({ ...bounds.max }),
    }) as Box3;
  }
}

/** An immutable material built in code: the spec with defaults filled in, frozen. */
class EngineMaterial implements Material {
  readonly spec: Readonly<MaterialSpec>;

  constructor(spec: MaterialSpec) {
    this.spec = Object.freeze({
      baseColor: spec.baseColor ?? "#ffffff",
      roughness: spec.roughness ?? 0.8,
      metallic: spec.metallic ?? 0,
      emissive: spec.emissive ?? "#000000",
      opacity: spec.opacity ?? 1,
      unlit: spec.unlit ?? false,
      ...(spec.baseColorMap !== undefined
        ? { baseColorMap: spec.baseColorMap }
        : {}),
      ...(spec.normalMap !== undefined ? { normalMap: spec.normalMap } : {}),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* glTF render models                                                         */
/* -------------------------------------------------------------------------- */

/** The material figures one glTF primitive resolves to at extraction. */
interface GlbMaterialParams {
  base: Rgba;
  emissive: readonly [number, number, number];
  translucent: boolean;
  /** Decoded base-color pixels for an embedded PNG image, or `null`. */
  basePixels: DecodedPng | null;
}

interface ModelPrimitive {
  data: MeshData;
  node: number;
  skin: number | null;
  material: GlbMaterialParams;
}

interface ModelNode {
  parent: number;
  matrix: Mat4 | null;
  t: Vec3;
  r: Quat;
  s: Vec3;
}

interface ModelSkin {
  joints: readonly number[];
  /** 16 floats per joint, column-major. */
  inverseBind: Float32Array | null;
}

interface ClipChannel {
  node: number;
  path: "translation" | "rotation" | "scale";
  times: Float32Array;
  values: Float32Array;
  step: boolean;
}

interface ModelClip {
  duration: number;
  channels: readonly ClipChannel[];
}

/** Everything the renderer needs from one decoded glTF binary, extracted once per handle. */
interface RenderModel {
  nodes: ModelNode[];
  primitives: ModelPrimitive[];
  skins: ModelSkin[];
  clips: Map<string, ModelClip>;
}

const RENDER_MODELS = new WeakMap<MeshHandle, RenderModel>();

const GLB_COMPONENT_READERS: Readonly<
  Record<
    number,
    { size: 1; read: (view: DataView, at: number) => number; norm: number }
  >
> = {
  5120: { size: 1, read: (v, at) => v.getInt8(at), norm: 127 },
  5121: { size: 1, read: (v, at) => v.getUint8(at), norm: 255 },
  5122: { size: 1, read: (v, at) => v.getInt16(at, true), norm: 32767 },
  5123: { size: 1, read: (v, at) => v.getUint16(at, true), norm: 65535 },
  5125: { size: 1, read: (v, at) => v.getUint32(at, true), norm: 1 },
  5126: { size: 1, read: (v, at) => v.getFloat32(at, true), norm: 1 },
};

const GLB_COMPONENT_BYTES: Readonly<Record<number, number>> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const GLB_TYPE_COMPONENTS: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
};

/** One accessor's values as floats, denormalized where the accessor says so. */
function readAccessor(
  glb: DecodedGlb,
  index: number | undefined,
): Float32Array | null {
  if (index === undefined) return null;
  const accessor = glb.json.accessors?.[index] as
    | (GlbAccessor & { normalized?: boolean })
    | undefined;
  if (accessor === undefined) return null;
  const components = GLB_TYPE_COMPONENTS[accessor.type ?? ""] ?? 0;
  const reader = GLB_COMPONENT_READERS[accessor.componentType ?? 0];
  const bytes = GLB_COMPONENT_BYTES[accessor.componentType ?? 0] ?? 0;
  const count = accessor.count ?? 0;
  if (components === 0 || reader === undefined || count === 0) return null;
  const viewIndex = accessor.bufferView;
  if (viewIndex === undefined) return new Float32Array(components * count);
  const view = glb.json.bufferViews?.[viewIndex] as GlbBufferView | undefined;
  if (view === undefined) return null;
  const stride = view.byteStride ?? components * bytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const data = new DataView(
    glb.bin.buffer,
    glb.bin.byteOffset,
    glb.bin.byteLength,
  );
  const out = new Float32Array(components * count);
  const norm = accessor.normalized === true ? reader.norm : 1;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < components; c++) {
      const at = start + i * stride + c * bytes;
      if (at + bytes > glb.bin.byteLength) return out;
      out[i * components + c] = reader.read(data, at) / norm;
    }
  }
  return out;
}

/** Averaged vertex normals for a primitive whose file carries none. */
function computeNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = (indices[i] ?? 0) * 3;
    const b = (indices[i + 1] ?? 0) * 3;
    const c = (indices[i + 2] ?? 0) * 3;
    const abx = (positions[b] ?? 0) - (positions[a] ?? 0);
    const aby = (positions[b + 1] ?? 0) - (positions[a + 1] ?? 0);
    const abz = (positions[b + 2] ?? 0) - (positions[a + 2] ?? 0);
    const acx = (positions[c] ?? 0) - (positions[a] ?? 0);
    const acy = (positions[c + 1] ?? 0) - (positions[a + 1] ?? 0);
    const acz = (positions[c + 2] ?? 0) - (positions[a + 2] ?? 0);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      normals[v] = (normals[v] ?? 0) + nx;
      normals[v + 1] = (normals[v + 1] ?? 0) + ny;
      normals[v + 2] = (normals[v + 2] ?? 0) + nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(
      normals[v] ?? 0,
      normals[v + 1] ?? 0,
      normals[v + 2] ?? 0,
    );
    if (len > 0) {
      normals[v] = (normals[v] ?? 0) / len;
      normals[v + 1] = (normals[v + 1] ?? 0) / len;
      normals[v + 2] = (normals[v + 2] ?? 0) / len;
    }
  }
  return normals;
}

/** The glTF JSON fields the extractor reads beyond what `assets.ts` types. */
interface GlbExtraJson {
  materials?: readonly {
    pbrMetallicRoughness?: {
      baseColorFactor?: readonly number[];
      baseColorTexture?: { index?: number };
    };
    emissiveFactor?: readonly number[];
    alphaMode?: string;
  }[];
  textures?: readonly { source?: number }[];
  images?: readonly { bufferView?: number; mimeType?: string }[];
  skins?: readonly {
    joints?: readonly number[];
    inverseBindMatrices?: number;
  }[];
  animations?: readonly {
    name?: string;
    channels?: readonly {
      sampler?: number;
      target?: { node?: number; path?: string };
    }[];
    samplers?: readonly {
      input?: number;
      output?: number;
      interpolation?: string;
    }[];
  }[];
}

/** One embedded image's decoded pixels, or `null` for a missing or non-PNG image. */
function decodeEmbeddedImage(
  glb: DecodedGlb,
  imageIndex: number | undefined,
  cache: Map<number, DecodedPng | null>,
): DecodedPng | null {
  if (imageIndex === undefined) return null;
  const cached = cache.get(imageIndex);
  if (cached !== undefined) return cached;
  const extra = glb.json as GlbExtraJson;
  const image = extra.images?.[imageIndex];
  const viewIndex = image?.bufferView;
  let pixels: DecodedPng | null = null;
  if (viewIndex !== undefined) {
    const view = glb.json.bufferViews?.[viewIndex] as GlbBufferView | undefined;
    if (view !== undefined) {
      const start = view.byteOffset ?? 0;
      const bytes = glb.bin.subarray(start, start + (view.byteLength ?? 0));
      try {
        pixels = decodePng(bytes);
      } catch {
        // A non-PNG embedded image (JPEG, say) draws untextured rather than
        // failing the whole mesh: the base color factor still stands.
        pixels = null;
      }
    }
  }
  cache.set(imageIndex, pixels);
  return pixels;
}

/** Extract the renderable model behind a mesh handle, once, keyed on the handle. */
function renderModelOf(handle: MeshHandle): RenderModel | null {
  const known = RENDER_MODELS.get(handle);
  if (known !== undefined) return known;
  const glb = decodedMesh(handle);
  if (glb === undefined) return null;
  const extra = glb.json as GlbExtraJson;

  const nodes: ModelNode[] = (glb.json.nodes ?? []).map((node: GlbNode) => ({
    parent: -1,
    matrix:
      node.matrix !== undefined && node.matrix.length === 16
        ? Float64Array.from(node.matrix)
        : null,
    t: {
      x: node.translation?.[0] ?? 0,
      y: node.translation?.[1] ?? 0,
      z: node.translation?.[2] ?? 0,
    },
    r: {
      x: node.rotation?.[0] ?? 0,
      y: node.rotation?.[1] ?? 0,
      z: node.rotation?.[2] ?? 0,
      w: node.rotation?.[3] ?? 1,
    },
    s: {
      x: node.scale?.[0] ?? 1,
      y: node.scale?.[1] ?? 1,
      z: node.scale?.[2] ?? 1,
    },
  }));
  for (const [index, node] of (glb.json.nodes ?? []).entries()) {
    for (const child of node.children ?? []) {
      const target = nodes[child];
      if (target !== undefined) target.parent = index;
    }
  }

  const imageCache = new Map<number, DecodedPng | null>();
  const materialParams = (
    materialIndex: number | undefined,
  ): GlbMaterialParams => {
    const material =
      materialIndex === undefined
        ? undefined
        : extra.materials?.[materialIndex];
    const factor = material?.pbrMetallicRoughness?.baseColorFactor;
    const emissive = material?.emissiveFactor;
    const textureIndex =
      material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const source =
      textureIndex === undefined
        ? undefined
        : extra.textures?.[textureIndex]?.source;
    return {
      base: [
        factor?.[0] ?? 1,
        factor?.[1] ?? 1,
        factor?.[2] ?? 1,
        factor?.[3] ?? 1,
      ],
      emissive: [emissive?.[0] ?? 0, emissive?.[1] ?? 0, emissive?.[2] ?? 0],
      translucent: material?.alphaMode === "BLEND" || (factor?.[3] ?? 1) < 1,
      basePixels: decodeEmbeddedImage(glb, source, imageCache),
    };
  };

  const primitives: ModelPrimitive[] = [];
  for (const [nodeIndex, node] of (glb.json.nodes ?? []).entries()) {
    if (node.mesh === undefined) continue;
    const mesh = glb.json.meshes?.[node.mesh];
    const skinIndex = (node as { skin?: number }).skin ?? null;
    for (const primitive of mesh?.primitives ?? []) {
      const attributes = primitive.attributes ?? {};
      const positions = readAccessor(glb, attributes["POSITION"]);
      if (positions === null) continue;
      const indicesFloat = readAccessor(
        glb,
        (primitive as { indices?: number }).indices,
      );
      const indices =
        indicesFloat === null
          ? Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
          : Uint32Array.from(indicesFloat);
      const normals =
        readAccessor(glb, attributes["NORMAL"]) ??
        computeNormals(positions, indices);
      const uvs =
        readAccessor(glb, attributes["TEXCOORD_0"]) ??
        new Float32Array((positions.length / 3) * 2);
      const joints = readAccessor(glb, attributes["JOINTS_0"]);
      const weights = readAccessor(glb, attributes["WEIGHTS_0"]);
      const data: MeshData = { positions, normals, uvs, indices };
      if (joints !== null && weights !== null) {
        data.joints = joints;
        data.weights = weights;
      }
      primitives.push({
        data,
        node: nodeIndex,
        skin: skinIndex,
        material: materialParams((primitive as { material?: number }).material),
      });
    }
  }

  const skins: ModelSkin[] = (extra.skins ?? []).map((skin) => ({
    joints: skin.joints ?? [],
    inverseBind: readAccessor(glb, skin.inverseBindMatrices),
  }));

  const clips = new Map<string, ModelClip>();
  for (const animation of extra.animations ?? []) {
    const channels: ClipChannel[] = [];
    let duration = 0;
    for (const channel of animation.channels ?? []) {
      const sampler = animation.samplers?.[channel.sampler ?? -1];
      const path = channel.target?.path;
      const node = channel.target?.node;
      if (sampler === undefined || node === undefined) continue;
      if (path !== "translation" && path !== "rotation" && path !== "scale")
        continue;
      const times = readAccessor(glb, sampler.input);
      let values = readAccessor(glb, sampler.output);
      if (times === null || values === null) continue;
      const components = path === "rotation" ? 4 : 3;
      if (sampler.interpolation === "CUBICSPLINE") {
        // Keep the middle "value" element of each in/value/out triple and
        // sample it linearly — the deterministic simplification.
        const flat = new Float32Array(times.length * components);
        for (let k = 0; k < times.length; k++) {
          for (let c = 0; c < components; c++) {
            flat[k * components + c] =
              values[(k * 3 + 1) * components + c] ?? 0;
          }
        }
        values = flat;
      }
      duration = Math.max(duration, times[times.length - 1] ?? 0);
      channels.push({
        node,
        path,
        times,
        values,
        step: sampler.interpolation === "STEP",
      });
    }
    if (animation.name !== undefined) {
      clips.set(animation.name, { duration, channels });
    }
  }

  const model: RenderModel = { nodes, primitives, skins, clips };
  RENDER_MODELS.set(handle, model);
  return model;
}

/** Sample one channel at `time`, writing the interpolated tuple into `out`. */
function sampleChannel(
  channel: ClipChannel,
  time: number,
  out: number[],
): void {
  const { times, values } = channel;
  const components = channel.path === "rotation" ? 4 : 3;
  const count = times.length;
  if (count === 0) return;
  let hi = 0;
  while (hi < count && (times[hi] ?? 0) < time) hi++;
  if (hi === 0) {
    for (let c = 0; c < components; c++) out[c] = values[c] ?? 0;
    return;
  }
  if (hi >= count) {
    for (let c = 0; c < components; c++)
      out[c] = values[(count - 1) * components + c] ?? 0;
    return;
  }
  const t0 = times[hi - 1] ?? 0;
  const t1 = times[hi] ?? 0;
  const span = t1 - t0;
  const mix = channel.step || span <= 0 ? 0 : (time - t0) / span;
  if (channel.path === "rotation") {
    // Normalized lerp with the sign fixed to the shorter arc — deterministic,
    // and indistinguishable from slerp at authoring keyframe densities.
    let dot = 0;
    for (let c = 0; c < 4; c++) {
      dot += (values[(hi - 1) * 4 + c] ?? 0) * (values[hi * 4 + c] ?? 0);
    }
    const sign = dot < 0 ? -1 : 1;
    let len = 0;
    for (let c = 0; c < 4; c++) {
      const value =
        (values[(hi - 1) * 4 + c] ?? 0) * (1 - mix) +
        sign * (values[hi * 4 + c] ?? 0) * mix;
      out[c] = value;
      len += value * value;
    }
    len = Math.sqrt(len) || 1;
    for (let c = 0; c < 4; c++) out[c] = (out[c] ?? 0) / len;
    return;
  }
  for (let c = 0; c < components; c++) {
    out[c] =
      (values[(hi - 1) * components + c] ?? 0) * (1 - mix) +
      (values[hi * components + c] ?? 0) * mix;
  }
}

/** Every node's global matrix under `clip` at `time` (already wrapped), rest pose for `null`. */
function poseGlobals(
  model: RenderModel,
  clip: ModelClip | null,
  time: number,
): Mat4[] {
  const locals: Mat4[] = model.nodes.map((node) => {
    if (clip === null && node.matrix !== null) return node.matrix;
    let t = node.t;
    let r = node.r;
    let s = node.s;
    if (clip !== null) {
      const tuple: number[] = [];
      for (const channel of clip.channels) {
        if (channel.node !== model.nodes.indexOf(node)) continue;
        sampleChannel(channel, time, tuple);
        if (channel.path === "translation")
          t = { x: tuple[0] ?? 0, y: tuple[1] ?? 0, z: tuple[2] ?? 0 };
        else if (channel.path === "rotation")
          r = {
            x: tuple[0] ?? 0,
            y: tuple[1] ?? 0,
            z: tuple[2] ?? 0,
            w: tuple[3] ?? 1,
          };
        else s = { x: tuple[0] ?? 1, y: tuple[1] ?? 1, z: tuple[2] ?? 1 };
      }
      if (node.matrix !== null) return node.matrix;
    }
    return mat4FromTrs(t, r, s);
  });
  const globals: (Mat4 | null)[] = model.nodes.map(() => null);
  const globalOf = (index: number): Mat4 => {
    const known = globals[index];
    if (known !== null && known !== undefined) return known;
    const node = model.nodes[index];
    const local = locals[index] ?? mat4Identity();
    const result =
      node === undefined || node.parent < 0
        ? local
        : mat4Multiply(globalOf(node.parent), local);
    globals[index] = result;
    return result;
  };
  return model.nodes.map((_, index) => globalOf(index));
}

/* -------------------------------------------------------------------------- */
/* Shaders                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * Both programs stay inside the GLSL ES 3.00 subset documented at
 * `packages/headless-webgl2/docs/glsl-subset.md`: `#version 300 es` first, no
 * structs or UBOs, lights as plain uniform arrays, the bounded-for-loop shape,
 * and only the listed built-ins — so the same sources compile in-process and
 * on real drivers.
 */

const SCENE_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_joints;
layout(location = 4) in vec4 a_weights;

uniform mat4 u_view_proj;
uniform mat4 u_model;
uniform mat3 u_normal_mat;
uniform int u_skinned;
uniform mat4 u_joint_mat[64];

out vec3 v_normal;
out vec2 v_uv;
out vec3 v_world;

void main() {
  vec4 local = vec4(a_position, 1.0);
  vec3 normal = a_normal;
  if (u_skinned == 1) {
    mat4 skin = u_joint_mat[int(a_joints.x)] * a_weights.x
      + u_joint_mat[int(a_joints.y)] * a_weights.y
      + u_joint_mat[int(a_joints.z)] * a_weights.z
      + u_joint_mat[int(a_joints.w)] * a_weights.w;
    local = skin * local;
    normal = mat3(skin) * normal;
  }
  vec4 world = u_model * local;
  v_world = world.xyz;
  v_normal = u_normal_mat * normal;
  v_uv = a_uv;
  gl_Position = u_view_proj * world;
}
`;

const SCENE_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec3 v_normal;
in vec2 v_uv;
in vec3 v_world;

uniform int u_shade;
uniform vec4 u_base;
uniform vec3 u_emissive;
uniform int u_has_base_map;
uniform sampler2D u_base_map;
uniform int u_light_count;
uniform int u_light_kind[64];
uniform vec3 u_light_color[64];
uniform vec3 u_light_vec[64];
uniform float u_light_range[64];

out vec4 o_color;

void main() {
  vec4 base = u_base;
  if (u_has_base_map == 1) {
    base = base * texture(u_base_map, v_uv);
  }
  if (u_shade == 3) {
    o_color = u_base;
    return;
  }
  if (u_shade == 2) {
    vec3 shown = normalize(v_normal);
    o_color = vec4((shown + vec3(1.0)) / 2.0, 1.0);
    return;
  }
  if (u_shade == 1) {
    o_color = base;
    return;
  }
  vec3 n = normalize(v_normal);
  vec3 lit = vec3(0.0);
  for (int i = 0; i < u_light_count; i++) {
    if (u_light_kind[i] == 0) {
      lit = lit + u_light_color[i];
    }
    if (u_light_kind[i] == 1) {
      vec3 toward = vec3(0.0) - u_light_vec[i];
      lit = lit + u_light_color[i] * max(dot(n, toward), 0.0);
    }
    if (u_light_kind[i] == 2) {
      vec3 offset = u_light_vec[i] - v_world;
      float distance_to = length(offset);
      float atten = 1.0;
      if (u_light_range[i] > 0.0) {
        atten = max(1.0 - distance_to / u_light_range[i], 0.0);
      }
      float lambert = 0.0;
      if (distance_to > 0.0) {
        lambert = max(dot(n, offset / distance_to), 0.0);
      }
      lit = lit + u_light_color[i] * lambert * atten;
    }
  }
  o_color = vec4(base.rgb * lit + u_emissive, base.a);
}
`;

const HUD_VERTEX_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;

uniform vec2 u_surface;

out vec2 v_uv;

void main() {
  float x = a_position.x / u_surface.x * 2.0 - 1.0;
  float y = 1.0 - a_position.y / u_surface.y * 2.0;
  v_uv = a_uv;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;

const HUD_FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;

uniform vec4 u_color;
uniform int u_has_map;
uniform sampler2D u_map;

out vec4 o_color;

void main() {
  vec4 color = u_color;
  if (u_has_map == 1) {
    color = color * texture(u_map, v_uv);
  }
  o_color = color;
}
`;

/* -------------------------------------------------------------------------- */
/* The WebGL2 back end                                                        */
/* -------------------------------------------------------------------------- */

/** GPU-side buffers for one tessellation, built on first draw, keyed on the data. */
interface GpuMesh {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  uv: WebGLBuffer;
  joints: WebGLBuffer | null;
  weights: WebGLBuffer | null;
  index: WebGLBuffer;
  indexCount: number;
  edges: WebGLBuffer | null;
  edgeCount: number;
}

/** The figures a material argument resolves to at draw time. */
interface MaterialParams {
  base: Rgba;
  emissive: readonly [number, number, number];
  unlit: boolean;
  basePixels: DecodedPng | null;
  /** Identity key for the base texture's GPU upload. */
  baseKey: object | null;
  translucent: boolean;
}

/** One deferred translucent draw: the run sorts them farthest-first at flush. */
interface DeferredDraw {
  distance: number;
  seq: number;
  execute: () => void;
}

/** One HUD draw, composited last, above the 3D picture, in issue order. */
type HudDraw = () => void;

/** Compile one stage, throwing with the info log — a bad fixed shader is an engine bug, and it must be loud. */
function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null)
    throw new Error(`the ${label} shader could not be created`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    throw new Error(
      `the ${label} shader failed to compile: ${gl.getShaderInfoLog(shader) ?? "no log"}`,
    );
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
  label: string,
): WebGLProgram {
  const program = gl.createProgram();
  if (program === null)
    throw new Error(`the ${label} program could not be created`);
  gl.attachShader(
    program,
    compileShader(gl, gl.VERTEX_SHADER, vertex, `${label} vertex`),
  );
  gl.attachShader(
    program,
    compileShader(gl, gl.FRAGMENT_SHADER, fragment, `${label} fragment`),
  );
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(
      `the ${label} program failed to link: ${gl.getProgramInfoLog(program) ?? "no log"}`,
    );
  }
  return program;
}

/**
 * The renderer: the WebGL2 half of the scene context. It executes the
 * vocabulary — runs, translucent deferral, the HUD pass — and owns every GPU
 * object; nothing above it touches the context.
 *
 * Internal: the engine alone constructs it, over the context the canvas
 * yielded; the scene context is its only caller.
 */
export class SceneRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly sceneProgram: WebGLProgram;
  private readonly hudProgram: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  private readonly gpuMeshes = new WeakMap<MeshData, GpuMesh>();
  private readonly textures = new WeakMap<object, WebGLTexture>();
  private readonly hudTextTextures = new LruCache<{
    handle: object;
    width: number;
    height: number;
  }>(256);
  private readonly scratchBuffers: WebGLBuffer[];

  private mode: RenderMode = "standard";
  private camera: CameraState;
  private lights: readonly LightState[] = [];
  private lightsDirty = true;
  private viewport: Viewport;
  private surface = { width: 0, height: 0 };
  private viewProj = mat4Identity();
  private drawsEnabled = true;

  private deferred: DeferredDraw[] = [];
  private hudDraws: HudDraw[] = [];
  private sequence = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.sceneProgram = linkProgram(
      gl,
      SCENE_VERTEX_SOURCE,
      SCENE_FRAGMENT_SOURCE,
      "scene",
    );
    this.hudProgram = linkProgram(
      gl,
      HUD_VERTEX_SOURCE,
      HUD_FRAGMENT_SOURCE,
      "hud",
    );
    this.scratchBuffers = [gl.createBuffer(), gl.createBuffer()].filter(
      (buffer): buffer is WebGLBuffer => buffer !== null,
    );
    this.camera = {
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fovY: Math.PI / 3,
      near: 0.1,
      far: 1000,
    };
    this.viewport = { width: 1, height: 1, scale: 1, offsetX: 0, offsetY: 0 };
    this.recomputeViewProj();
  }

  /* ------------------------------------------------------------------ */
  /* Frame and state                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Open a frame: clear the whole canvas to `background` (transparency for
   * `null`) with the depth state reset, then confine every draw to the
   * letterbox fit. The bars sit outside the scissor, so they stay exactly as
   * cleared — that is "the letterbox bars are cleared outside the picture".
   */
  beginFrame(
    background: string | null,
    viewport: Viewport,
    surface: { width: number; height: number },
  ): void {
    const gl = this.gl;
    this.viewport = { ...viewport };
    this.surface = { ...surface };
    this.deferred = [];
    this.hudDraws = [];
    this.sequence = 0;
    this.recomputeViewProj();

    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.depthMask(true);
    const clear =
      background === null ? ([0, 0, 0, 0] as Rgba) : parseColor(background);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    const fitWidth = Math.round(viewport.width * viewport.scale);
    const fitHeight = Math.round(viewport.height * viewport.scale);
    this.drawsEnabled = viewport.scale > 0 && fitWidth > 0 && fitHeight > 0;
    if (this.drawsEnabled) {
      const x = Math.round(viewport.offsetX);
      const y = surface.height - Math.round(viewport.offsetY) - fitHeight;
      gl.viewport(x, y, fitWidth, fitHeight);
      gl.scissor(x, y, fitWidth, fitHeight);
      gl.enable(gl.SCISSOR_TEST);
    }
  }

  /** Close the frame: flush the last run's translucent draws, then composite the HUD. */
  endFrame(): void {
    this.flushRun();
    if (this.drawsEnabled) {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      for (const draw of this.hudDraws) draw();
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
    }
    this.hudDraws = [];
  }

  /** A state change closes the run: pending translucent draws render under the outgoing state. */
  applyMode(mode: RenderMode): void {
    this.flushRun();
    this.mode = mode;
  }

  applyCamera(camera: CameraState): void {
    this.flushRun();
    this.camera = {
      position: { ...camera.position },
      rotation: { ...camera.rotation },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    };
    this.recomputeViewProj();
  }

  applyLights(lights: readonly LightState[]): void {
    this.flushRun();
    // The renderer uses the first 64 entries — the format's own bound.
    this.lights = lights.slice(0, 64);
    this.lightsDirty = true;
  }

  /** The vocabulary's depth clear: flush the run, then clear depth where it stands. */
  clearDepthOp(): void {
    this.flushRun();
    if (!this.drawsEnabled) return;
    const gl = this.gl;
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }

  private recomputeViewProj(): void {
    const aspect = this.viewport.width / Math.max(this.viewport.height, 1e-9);
    this.viewProj = mat4Multiply(
      mat4Perspective(
        this.camera.fovY,
        aspect,
        this.camera.near,
        this.camera.far,
      ),
      mat4View(this.camera),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Material resolution                                                */
  /* ------------------------------------------------------------------ */

  /**
   * A `MaterialLike` as draw figures. A `Color` is the documented shorthand
   * for a standard lit material with that base color; a `MaterialHandle`
   * contributes its base-color map (the other slots ride along in captures
   * but do not move this renderer's Lambert shading); a `Material` is its
   * filled spec.
   */
  resolveMaterial(material: MaterialLike | undefined): MaterialParams {
    if (material === undefined || typeof material === "string") {
      const base = parseColor(material ?? "#ffffff");
      return {
        base,
        emissive: [0, 0, 0],
        unlit: false,
        basePixels: null,
        baseKey: null,
        translucent: base[3] < 1,
      };
    }
    if (material instanceof EngineMaterial || isMaterialSpecLike(material)) {
      const spec = (material as Material).spec;
      const base = parseColor(spec.baseColor ?? "#ffffff");
      const opacity = clampOpacity(spec.opacity ?? 1);
      const emissive = parseColor(spec.emissive ?? "#000000");
      const map = spec.baseColorMap;
      const pixels = map === undefined ? undefined : texturePixelsOf(map);
      return {
        base: [base[0], base[1], base[2], base[3] * opacity],
        emissive: [emissive[0], emissive[1], emissive[2]],
        unlit: spec.unlit ?? false,
        basePixels: pixels ?? null,
        baseKey: pixels !== undefined && map !== undefined ? map : null,
        translucent: opacity < 1 || base[3] < 1,
      };
    }
    // A MaterialHandle: white base multiplied by its base-color map.
    const handle = material as MaterialHandle;
    const map = handle.maps.baseColor;
    const pixels = map === undefined ? undefined : texturePixelsOf(map);
    return {
      base: [1, 1, 1, 1],
      emissive: [0, 0, 0],
      unlit: false,
      basePixels: pixels ?? null,
      baseKey: pixels !== undefined && map !== undefined ? map : null,
      translucent: false,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Draw execution                                                     */
  /* ------------------------------------------------------------------ */

  drawGeometry(
    geometry: EngineGeometry,
    material: MaterialParams,
    transform: Transform,
  ): void {
    if (!this.drawsEnabled) return;
    const model = mat4FromTrs(
      transform.position,
      transform.rotation,
      transform.scale,
    );
    this.submitMesh(geometry.data, model, material, null, transform.position);
  }

  drawMesh(
    handle: MeshHandle,
    transform: Transform,
    override: MaterialParams | null,
    clip: string | null,
    clipTime: number,
  ): void {
    if (!this.drawsEnabled) return;
    const renderModel = renderModelOf(handle);
    if (renderModel === null) return;
    const clipData =
      clip === null ? null : (renderModel.clips.get(clip) ?? null);
    const time =
      clipData === null || clipData.duration <= 0
        ? 0
        : ((clipTime % clipData.duration) + clipData.duration) %
          clipData.duration;
    const globals = poseGlobals(renderModel, clipData, time);
    const world = mat4FromTrs(
      transform.position,
      transform.rotation,
      transform.scale,
    );
    for (const primitive of renderModel.primitives) {
      const material =
        override ??
        ({
          base: primitive.material.base,
          emissive: primitive.material.emissive,
          unlit: false,
          basePixels: primitive.material.basePixels,
          baseKey: primitive.material.basePixels,
          translucent: primitive.material.translucent,
        } satisfies MaterialParams);
      let skinMatrices: Float32Array | null = null;
      let model: Mat4;
      if (primitive.skin !== null && primitive.data.joints !== undefined) {
        // A skinned primitive poses from its joints alone; its node's own
        // transform does not apply, per the glTF contract.
        model = world;
        const skin = renderModel.skins[primitive.skin];
        if (skin !== undefined) {
          const jointCount = Math.min(skin.joints.length, 64);
          skinMatrices = new Float32Array(jointCount * 16);
          for (let j = 0; j < jointCount; j++) {
            const jointGlobal = globals[skin.joints[j] ?? 0] ?? mat4Identity();
            let jointMatrix = jointGlobal;
            const bind = skin.inverseBind;
            if (bind !== null) {
              const inverse = new Float64Array(16);
              for (let k = 0; k < 16; k++) inverse[k] = bind[j * 16 + k] ?? 0;
              jointMatrix = mat4Multiply(jointGlobal, inverse);
            }
            for (let k = 0; k < 16; k++)
              skinMatrices[j * 16 + k] = jointMatrix[k] ?? 0;
          }
        }
      } else {
        model = mat4Multiply(world, globals[primitive.node] ?? mat4Identity());
      }
      this.submitMesh(
        primitive.data,
        model,
        material,
        skinMatrices,
        transform.position,
      );
    }
  }

  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void {
    if (!this.drawsEnabled) return;
    const pixels = texturePixelsOf(texture);
    if (pixels === undefined) return;
    const seq = this.sequence++;
    // Every billboard is translucent by the shared draw-order rule, and its
    // quad faces the run's camera, so the corners are computed at flush.
    this.deferred.push({
      distance: this.distanceTo(position),
      seq,
      execute: () => this.executeBillboard(texture, pixels, position, size),
    });
  }

  drawLine(points: readonly Vec3[], color: Color): void {
    if (!this.drawsEnabled || points.length < 2) return;
    const rgba = parseColor(color);
    const flat = new Float32Array(points.length * 3);
    for (const [i, point] of points.entries()) {
      flat[i * 3] = point.x;
      flat[i * 3 + 1] = point.y;
      flat[i * 3 + 2] = point.z;
    }
    const first = points[0]!;
    if (rgba[3] < 1) {
      const seq = this.sequence++;
      this.deferred.push({
        distance: this.distanceTo(first),
        seq,
        execute: () => this.executeLine(flat, rgba),
      });
      return;
    }
    this.executeLine(flat, rgba);
  }

  drawHudText(
    text: string,
    position: Vec2,
    options: Required<HudTextOptions>,
  ): void {
    if (!this.drawsEnabled) return;
    this.hudDraws.push(() => this.executeHudText(text, position, options));
  }

  drawHudRect(position: Vec2, size: Vec2, color: Color): void {
    if (!this.drawsEnabled) return;
    const rgba = parseColor(color);
    this.hudDraws.push(() => this.executeHudRect(position, size, rgba));
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                          */
  /* ------------------------------------------------------------------ */

  private distanceTo(position: Vec3): number {
    const dx = position.x - this.camera.position.x;
    const dy = position.y - this.camera.position.y;
    const dz = position.z - this.camera.position.z;
    return Math.hypot(dx, dy, dz);
  }

  /** Route one mesh-shaped draw: wireframe lowers to edges, translucency defers. */
  private submitMesh(
    data: MeshData,
    model: Mat4,
    material: MaterialParams,
    skinMatrices: Float32Array | null,
    at: Vec3,
  ): void {
    if (this.mode === "wireframe") {
      // Triangle edges alone, unlit, one stroke width, in the draw's color.
      const color: Rgba = [
        material.base[0],
        material.base[1],
        material.base[2],
        1,
      ];
      this.executeMesh(data, model, material, skinMatrices, 3, color, true);
      return;
    }
    const translucent = this.mode === "standard" && material.translucent;
    if (translucent) {
      const seq = this.sequence++;
      this.deferred.push({
        distance: this.distanceTo(at),
        seq,
        execute: () =>
          this.executeMesh(
            data,
            model,
            material,
            skinMatrices,
            this.shadeOf(material),
            material.base,
            false,
          ),
      });
      return;
    }
    this.executeMesh(
      data,
      model,
      material,
      skinMatrices,
      this.shadeOf(material),
      material.base,
      false,
    );
  }

  /** The scene program's shade selector for a material draw under the current mode. */
  private shadeOf(material: MaterialParams): number {
    if (this.mode === "normals") return 2;
    if (this.mode === "unlit" || material.unlit) return 1;
    return 0;
  }

  private flushRun(): void {
    if (this.deferred.length === 0) return;
    const run = this.deferred;
    this.deferred = [];
    // Farthest-first by the distance from the run's camera to the draw's
    // position, ties broken by issue order — the shared draw-order rule.
    run.sort((a, b) => b.distance - a.distance || a.seq - b.seq);
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const draw of run) draw.execute();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  private location(
    program: WebGLProgram,
    name: string,
  ): WebGLUniformLocation | null {
    const key = `${program === this.sceneProgram ? "s" : "h"}:${name}`;
    if (!this.locations.has(key)) {
      this.locations.set(key, this.gl.getUniformLocation(program, name));
    }
    return this.locations.get(key) ?? null;
  }

  private gpuMesh(data: MeshData): GpuMesh {
    const known = this.gpuMeshes.get(data);
    if (known !== undefined) return known;
    const gl = this.gl;
    const upload = (array: Float32Array): WebGLBuffer => {
      const buffer = gl.createBuffer();
      if (buffer === null)
        throw new Error("a vertex buffer could not be created");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
      return buffer;
    };
    const index = gl.createBuffer();
    if (index === null) throw new Error("an index buffer could not be created");
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    const built: GpuMesh = {
      position: upload(data.positions),
      normal: upload(data.normals),
      uv: upload(data.uvs),
      joints: data.joints !== undefined ? upload(data.joints) : null,
      weights: data.weights !== undefined ? upload(data.weights) : null,
      index,
      indexCount: data.indices.length,
      edges: null,
      edgeCount: 0,
    };
    this.gpuMeshes.set(data, built);
    return built;
  }

  private gpuEdges(data: MeshData): { buffer: WebGLBuffer; count: number } {
    const mesh = this.gpuMesh(data);
    if (mesh.edges === null) {
      const gl = this.gl;
      const edges = edgeIndices(data.indices);
      const buffer = gl.createBuffer();
      if (buffer === null)
        throw new Error("an edge index buffer could not be created");
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, edges, gl.STATIC_DRAW);
      mesh.edges = buffer;
      mesh.edgeCount = edges.length;
    }
    return { buffer: mesh.edges, count: mesh.edgeCount };
  }

  /** Upload-once texture per pixels identity: RGBA8, clamped, base-level filtering, no mipmaps. */
  private texture(
    key: object,
    pixels: DecodedPng,
    nearest: boolean,
  ): WebGLTexture {
    const gl = this.gl;
    const known = this.textures.get(key);
    if (known !== undefined) return known;
    const texture = gl.createTexture();
    if (texture === null) throw new Error("a texture could not be created");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      pixels.width,
      pixels.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels.pixels,
    );
    const filter = nearest ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(key, texture);
    return texture;
  }

  private uploadLights(): void {
    if (!this.lightsDirty) return;
    this.lightsDirty = false;
    const gl = this.gl;
    const count = this.lights.length;
    const kinds = new Int32Array(64);
    const colors = new Float32Array(192);
    const vectors = new Float32Array(192);
    const ranges = new Float32Array(64);
    for (let i = 0; i < count; i++) {
      const light = this.lights[i]!;
      const color = parseColor(light.color);
      colors[i * 3] = color[0] * light.intensity;
      colors[i * 3 + 1] = color[1] * light.intensity;
      colors[i * 3 + 2] = color[2] * light.intensity;
      if (light.type === "ambient") {
        kinds[i] = 0;
      } else if (light.type === "directional") {
        kinds[i] = 1;
        vectors[i * 3] = light.direction.x;
        vectors[i * 3 + 1] = light.direction.y;
        vectors[i * 3 + 2] = light.direction.z;
      } else {
        kinds[i] = 2;
        vectors[i * 3] = light.position.x;
        vectors[i * 3 + 1] = light.position.y;
        vectors[i * 3 + 2] = light.position.z;
        ranges[i] = light.range;
      }
    }
    gl.uniform1i(this.location(this.sceneProgram, "u_light_count"), count);
    gl.uniform1iv(this.location(this.sceneProgram, "u_light_kind"), kinds);
    gl.uniform3fv(this.location(this.sceneProgram, "u_light_color"), colors);
    gl.uniform3fv(this.location(this.sceneProgram, "u_light_vec"), vectors);
    gl.uniform1fv(this.location(this.sceneProgram, "u_light_range"), ranges);
  }

  private bindSceneAttributes(mesh: GpuMesh): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    if (mesh.joints !== null && mesh.weights !== null) {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.joints);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.weights);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(3);
      gl.disableVertexAttribArray(4);
      gl.vertexAttrib4f(3, 0, 0, 0, 0);
      gl.vertexAttrib4f(4, 0, 0, 0, 0);
    }
  }

  private executeMesh(
    data: MeshData,
    model: Mat4,
    material: MaterialParams,
    skinMatrices: Float32Array | null,
    shade: number,
    color: Rgba,
    edges: boolean,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.sceneProgram);
    this.lightsDirty = true; // program state may have been touched by the HUD pass
    this.uploadLights();
    gl.uniformMatrix4fv(
      this.location(this.sceneProgram, "u_view_proj"),
      false,
      mat4ToFloat32(this.viewProj),
    );
    gl.uniformMatrix4fv(
      this.location(this.sceneProgram, "u_model"),
      false,
      mat4ToFloat32(model),
    );
    gl.uniformMatrix3fv(
      this.location(this.sceneProgram, "u_normal_mat"),
      false,
      normalMatrix(model),
    );
    gl.uniform1i(this.location(this.sceneProgram, "u_shade"), shade);
    // `unlit` draws base colors at full brightness *and full opacity*, so the
    // alpha a translucent material carries is dropped along with the lighting.
    const alpha = this.mode === "unlit" ? 1 : color[3];
    gl.uniform4f(
      this.location(this.sceneProgram, "u_base"),
      color[0],
      color[1],
      color[2],
      alpha,
    );
    gl.uniform3f(
      this.location(this.sceneProgram, "u_emissive"),
      material.emissive[0],
      material.emissive[1],
      material.emissive[2],
    );
    const textured = !edges && material.basePixels !== null && shade !== 2;
    gl.uniform1i(
      this.location(this.sceneProgram, "u_has_base_map"),
      textured ? 1 : 0,
    );
    if (textured && material.basePixels !== null) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(
        gl.TEXTURE_2D,
        this.texture(
          material.baseKey ?? material.basePixels,
          material.basePixels,
          false,
        ),
      );
      gl.uniform1i(this.location(this.sceneProgram, "u_base_map"), 0);
    }
    gl.uniform1i(
      this.location(this.sceneProgram, "u_skinned"),
      skinMatrices !== null ? 1 : 0,
    );
    if (skinMatrices !== null) {
      gl.uniformMatrix4fv(
        this.location(this.sceneProgram, "u_joint_mat"),
        false,
        skinMatrices,
      );
    }
    const mesh = this.gpuMesh(data);
    this.bindSceneAttributes(mesh);
    if (edges) {
      const edgeSet = this.gpuEdges(data);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeSet.buffer);
      gl.drawElements(gl.LINES, edgeSet.count, gl.UNSIGNED_INT, 0);
    } else {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.index);
      gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
    }
  }

  private executeBillboard(
    texture: TextureHandle,
    pixels: DecodedPng,
    position: Vec3,
    size: Vec2,
  ): void {
    // The quad faces the run's camera: its plane is spanned by the camera's
    // world right and up axes, centered at the position.
    const right = rotateVec3(this.camera.rotation, { x: 1, y: 0, z: 0 });
    const up = rotateVec3(this.camera.rotation, { x: 0, y: 1, z: 0 });
    const hw = size.x / 2;
    const hh = size.y / 2;
    const corner = (sx: number, sy: number): [number, number, number] => [
      position.x + right.x * hw * sx + up.x * hh * sy,
      position.y + right.y * hw * sx + up.y * hh * sy,
      position.z + right.z * hw * sx + up.z * hh * sy,
    ];
    const corners = [
      corner(-1, 1),
      corner(1, 1),
      corner(1, -1),
      corner(-1, -1),
    ];
    const positions = new Float32Array([
      ...corners[0]!,
      ...corners[1]!,
      ...corners[2]!,
      ...corners[0]!,
      ...corners[2]!,
      ...corners[3]!,
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    const normal = rotateVec3(this.camera.rotation, { x: 0, y: 0, z: 1 });
    const normals = new Float32Array(18);
    for (let i = 0; i < 6; i++) {
      normals[i * 3] = normal.x;
      normals[i * 3 + 1] = normal.y;
      normals[i * 3 + 2] = normal.z;
    }
    const gl = this.gl;
    gl.useProgram(this.sceneProgram);
    gl.uniformMatrix4fv(
      this.location(this.sceneProgram, "u_view_proj"),
      false,
      mat4ToFloat32(this.viewProj),
    );
    gl.uniformMatrix4fv(
      this.location(this.sceneProgram, "u_model"),
      false,
      mat4ToFloat32(mat4Identity()),
    );
    gl.uniformMatrix3fv(
      this.location(this.sceneProgram, "u_normal_mat"),
      false,
      Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    );
    // Billboards render the same under every mode: unlit, alpha-blended.
    gl.uniform1i(this.location(this.sceneProgram, "u_shade"), 1);
    gl.uniform4f(this.location(this.sceneProgram, "u_base"), 1, 1, 1, 1);
    gl.uniform3f(this.location(this.sceneProgram, "u_emissive"), 0, 0, 0);
    gl.uniform1i(this.location(this.sceneProgram, "u_has_base_map"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(texture, pixels, true));
    gl.uniform1i(this.location(this.sceneProgram, "u_base_map"), 0);
    gl.uniform1i(this.location(this.sceneProgram, "u_skinned"), 0);
    this.drawScratch(positions, normals, uvs, 6);
  }

  private executeLine(positions: Float32Array, color: Rgba): void {
    // Blending is the run's, set around the deferred flush: a translucent line
    // defers and an opaque one does not, and neither decides the state itself.
    const gl = this.gl;
    gl.useProgram(this.sceneProgram);
    gl.uniformMatrix4fv(
      this.location(this.sceneProgram, "u_view_proj"),
      false,
      mat4ToFloat32(this.viewProj),
    );
    gl.uniformMatrix4fv(
      this.location(this.sceneProgram, "u_model"),
      false,
      mat4ToFloat32(mat4Identity()),
    );
    gl.uniformMatrix3fv(
      this.location(this.sceneProgram, "u_normal_mat"),
      false,
      Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    );
    gl.uniform1i(this.location(this.sceneProgram, "u_shade"), 3);
    gl.uniform4f(
      this.location(this.sceneProgram, "u_base"),
      color[0],
      color[1],
      color[2],
      color[3],
    );
    gl.uniform1i(this.location(this.sceneProgram, "u_has_base_map"), 0);
    gl.uniform1i(this.location(this.sceneProgram, "u_skinned"), 0);
    const count = positions.length / 3;
    this.drawScratch(positions, null, null, count, gl.LINE_STRIP);
  }

  /** Draw from the scratch buffers: transient vertex data that never persists. */
  private drawScratch(
    positions: Float32Array,
    normals: Float32Array | null,
    uvs: Float32Array | null,
    count: number,
    mode?: number,
  ): void {
    const gl = this.gl;
    const positionBuffer = this.scratchBuffers[0];
    const attributeBuffer = this.scratchBuffers[1];
    if (positionBuffer === undefined || attributeBuffer === undefined) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(3);
    gl.disableVertexAttribArray(4);
    gl.vertexAttrib3f(1, 0, 0, 1);
    gl.vertexAttrib4f(3, 0, 0, 0, 0);
    gl.vertexAttrib4f(4, 0, 0, 0, 0);
    if (normals !== null) {
      gl.bindBuffer(gl.ARRAY_BUFFER, attributeBuffer);
      const interleaved = new Float32Array(normals.length + (uvs?.length ?? 0));
      interleaved.set(normals, 0);
      if (uvs !== null) interleaved.set(uvs, normals.length);
      gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      if (uvs !== null) {
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, normals.length * 4);
      } else {
        gl.disableVertexAttribArray(2);
        gl.vertexAttrib2f(2, 0, 0);
      }
    } else {
      gl.disableVertexAttribArray(2);
      gl.vertexAttrib2f(2, 0, 0);
    }
    gl.drawArrays(mode ?? gl.TRIANGLES, 0, count);
  }

  private executeHudText(
    text: string,
    position: Vec2,
    options: Required<HudTextOptions>,
  ): void {
    // White glyphs tinted by the uniform, so one texture per string serves
    // every color a build letters it in.
    const key = text;
    let entry = this.hudTextTextures.get(key);
    if (entry === undefined) {
      const pixels = rasterizeText(text, [1, 1, 1], 255);
      entry = { handle: { text }, width: pixels.width, height: pixels.height };
      this.texture(entry.handle, pixels, true);
      this.hudTextTextures.set(key, entry);
    }
    const chars = [...text].length;
    // `size` is the height of the 16-pixel cell in logical units; each glyph
    // advances half of `size`.
    const width = (options.size / 2) * chars;
    const anchor =
      options.align === "center"
        ? width / 2
        : options.align === "right"
          ? width
          : 0;
    const scale = this.viewport.scale;
    const x = this.viewport.offsetX + (position.x - anchor) * scale;
    const y = this.viewport.offsetY + position.y * scale;
    const rgba = parseColor(options.color);
    this.hudQuad(x, y, width * scale, options.size * scale, rgba, entry.handle);
  }

  private executeHudRect(position: Vec2, size: Vec2, color: Rgba): void {
    const scale = this.viewport.scale;
    this.hudQuad(
      this.viewport.offsetX + position.x * scale,
      this.viewport.offsetY + position.y * scale,
      size.x * scale,
      size.y * scale,
      color,
      null,
    );
  }

  private hudQuad(
    x: number,
    y: number,
    width: number,
    height: number,
    color: Rgba,
    textureKey: object | null,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.hudProgram);
    gl.uniform2f(
      this.location(this.hudProgram, "u_surface"),
      this.surface.width,
      this.surface.height,
    );
    gl.uniform4f(
      this.location(this.hudProgram, "u_color"),
      color[0],
      color[1],
      color[2],
      color[3],
    );
    gl.uniform1i(
      this.location(this.hudProgram, "u_has_map"),
      textureKey !== null ? 1 : 0,
    );
    if (textureKey !== null) {
      gl.activeTexture(gl.TEXTURE0);
      const texture = this.textures.get(textureKey);
      if (texture === undefined) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.location(this.hudProgram, "u_map"), 0);
    }
    const positionBuffer = this.scratchBuffers[0];
    const uvBuffer = this.scratchBuffers[1];
    if (positionBuffer === undefined || uvBuffer === undefined) return;
    const positions = new Float32Array([
      x,
      y,
      x + width,
      y,
      x + width,
      y + height,
      x,
      y,
      x + width,
      y + height,
      x,
      y + height,
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(2);
    gl.disableVertexAttribArray(3);
    gl.disableVertexAttribArray(4);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

/** Whether a value carries a `Material`-shaped frozen spec (a foreign but well-shaped material). */
function isMaterialSpecLike(value: object): value is Material {
  const spec = (value as { spec?: unknown }).spec;
  return (
    spec !== null && typeof spec === "object" && !("maps" in (value as object))
  );
}

/** The decoded pixels behind any texture the engine can draw: loaded, or rasterized here. */
function texturePixelsOf(handle: object): DecodedPng | undefined {
  return (
    decodedTexture(handle as TextureHandle) ?? RASTERIZED_PIXELS.get(handle)
  );
}

/* -------------------------------------------------------------------------- */
/* Handle description for the recorder                                        */
/* -------------------------------------------------------------------------- */

/** The seven map slots in one fixed walk order, for material capture. */
const MATERIAL_SLOTS: readonly MaterialMapSlot[] = [
  "baseColor",
  "normal",
  "roughness",
  "metallic",
  "ao",
  "emissive",
  "height",
];

/**
 * The recorder's view of the engine's handles. A mesh is recognized by the
 * decoded glTF parked behind it, a texture by its decoded or rasterized
 * pixels, and a material structurally — a `path` beside a `maps` record whose
 * every entry is itself a recognizable texture. Anything else is not a handle
 * and encodes as plain data or an opaque marker.
 */
export function describeEngineHandle(value: object): HandleDescription | null {
  const glb = decodedMesh(value as MeshHandle);
  if (glb !== undefined) {
    const path = (value as MeshHandle).path;
    return {
      name: "MeshHandle",
      capture: (): HandleCapturePayload => ({
        kind: "mesh",
        path,
        bytes: encodeGlb(glb),
      }),
    };
  }
  const pixels = texturePixelsOf(value);
  if (pixels !== undefined) {
    const handle = value as TextureHandle;
    return {
      name: "TextureHandle",
      capture: (): HandleCapturePayload => ({
        kind: "texture",
        path: handle.path,
        width: pixels.width,
        height: pixels.height,
        png: encodePng(pixels.width, pixels.height, pixels.pixels),
      }),
    };
  }
  const maybe = value as { path?: unknown; maps?: unknown };
  if (
    typeof maybe.path === "string" &&
    maybe.maps !== null &&
    typeof maybe.maps === "object"
  ) {
    const maps = maybe.maps as Readonly<
      Partial<Record<MaterialMapSlot, object>>
    >;
    const entries: (readonly [MaterialMapSlot, object])[] = [];
    for (const slot of MATERIAL_SLOTS) {
      const texture = maps[slot];
      if (texture === undefined) continue;
      if (texturePixelsOf(texture) === undefined) return null;
      entries.push([slot, texture] as const);
    }
    const path = maybe.path;
    return {
      name: "MaterialHandle",
      capture: (): HandleCapturePayload => ({
        kind: "material",
        path,
        maps: entries,
      }),
    };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* The scene context                                                          */
/* -------------------------------------------------------------------------- */

/** The envelope the recorder snapshots at arm time — the engine's own options. */
export interface SceneEnvelope {
  width: number;
  height: number;
  background: string | null;
}

/** Where a scene-context call is arriving from, for the two documented guards. */
type ScenePhase = "outside" | "pipeline" | "component";

/** Whether every number in a transform is finite. */
function isFiniteTransform(t: Transform): boolean {
  return (
    isFiniteVec3(t.position) &&
    isFiniteVec3(t.scale) &&
    Number.isFinite(t.rotation.x) &&
    Number.isFinite(t.rotation.y) &&
    Number.isFinite(t.rotation.z) &&
    Number.isFinite(t.rotation.w)
  );
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isFiniteVec2(v: Vec2): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y);
}

/** One producer dimension, refused by name unless finite and positive. */
function requirePositive(method: string, name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `${method} ${name} must be finite and positive, got ${value}`,
    );
  }
}

/** One `createMaterial` unit field, refused by name unless finite and inside `0..1`. */
function requireUnit(name: string, value: number | undefined): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(
      `createMaterial ${name} must be a finite number between 0 and 1, got ${value}`,
    );
  }
}

const RENDER_MODES: readonly RenderMode[] = [
  "standard",
  "wireframe",
  "unlit",
  "normals",
];

/** The `setMode` refusal both the scene context and `engine.renderer` share. */
function requireMode(mode: RenderMode): void {
  if (!RENDER_MODES.includes(mode)) {
    throw new Error(
      `setMode was called with "${String(mode)}", which is not a render mode: the modes are "standard", "wireframe", "unlit", and "normals"`,
    );
  }
}

/**
 * The engine-owned scene context: the shared ten-verb vocabulary, validated,
 * recorded, and executed — in that order for the soft rules (a non-finite
 * draw is recorded and draws nothing) and with hard misuse refused before
 * anything is recorded.
 *
 * One instance lives for the engine's whole life; the recorder inside it is
 * a flag rather than a wrapper, so the identity a `DrawComponent` keeps stays
 * the object the pipeline draws through.
 */
export class EngineSceneContext implements SceneContext {
  private readonly renderer: SceneRenderer;
  private readonly sceneRecorder: SceneRecorder;
  private phase: ScenePhase = "outside";

  /** The retained renderer state — what a frame inherits. Moved only by the state setters. */
  private retainedCamera: CameraState;
  private retainedLights: readonly LightState[] = [];
  private retainedMode: RenderMode = "standard";

  constructor(renderer: SceneRenderer, envelope: () => SceneEnvelope) {
    this.renderer = renderer;
    this.sceneRecorder = new SceneRecorder({
      envelope,
      describeHandle: describeEngineHandle,
    });
    this.retainedCamera = {
      position: { x: 0, y: 0, z: 10 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      fovY: Math.PI / 3,
      near: 0.1,
      far: 1000,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Engine wiring (not part of the vocabulary)                          */
  /* ------------------------------------------------------------------ */

  /** Whether operations are being captured — `engine.recording()`. */
  recording(): boolean {
    return this.sceneRecorder.active();
  }

  /** Arms the recorder — `engine.startRecording()`. Throws on an unbalanced call. */
  startRecording(): void {
    this.sceneRecorder.start();
  }

  /** Disarms and returns the capture — `engine.stopRecording()`. Throws on an unbalanced call. */
  stopRecording(): ReturnType<SceneRecorder["stop"]> {
    return this.sceneRecorder.stop();
  }

  /**
   * Open the recording's frame bracket. Belongs at the top of the whole
   * engine frame, before the ticks run, so a recorder armed from inside a
   * tick captures whole frames only; it snapshots the retained renderer
   * state the frame inherited.
   */
  openFrame(surface: { width: number; height: number }): void {
    this.sceneRecorder.openFrame(
      {
        camera: this.retainedCamera,
        lights: this.retainedLights,
        mode: this.retainedMode,
      },
      surface,
    );
  }

  /** Close the frame bracket with the engine's exact figures — after the pipeline has drawn. */
  closeFrame(figures: FrameFigures): void {
    this.sceneRecorder.closeFrame(figures);
  }

  /** Internal: the pipeline opens its draw phase around a frame's drawing. */
  enterPipeline(): void {
    this.phase = "pipeline";
  }

  /** Internal: the pipeline closes its draw phase. */
  exitPipeline(): void {
    this.phase = "outside";
  }

  /** Internal: a `DrawComponent.draw` runs with the state setters off limits. */
  enterComponentDraw(): void {
    this.phase = "component";
  }

  /** Internal: back to the pipeline's own phase. */
  exitComponentDraw(): void {
    this.phase = "pipeline";
  }

  /** The retained state, for the engine's own reads (tests included). */
  retainedState(): {
    camera: CameraState;
    lights: readonly LightState[];
    mode: RenderMode;
  } {
    return {
      camera: {
        ...this.retainedCamera,
        position: { ...this.retainedCamera.position },
        rotation: { ...this.retainedCamera.rotation },
      },
      lights: this.retainedLights.map((light) => ({ ...light })),
      mode: this.retainedMode,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Guards                                                             */
  /* ------------------------------------------------------------------ */

  /** Every vocabulary method is live only while the pipeline draws. */
  private assertInside(method: string): void {
    if (this.phase === "outside") {
      throw new Error(
        `${method} was called outside the render pipeline: the scene context is live only while the pipeline draws, so draw from a DrawComponent's draw`,
      );
    }
  }

  /** The four pipeline-owned calls are off limits to a `DrawComponent`. */
  private assertPipelineOwned(method: string): void {
    this.assertInside(method);
    if (this.phase === "component") {
      throw new Error(
        `${method} was called from a DrawComponent's draw: the camera, the lights, the mode, and the depth clear belong to the pipeline`,
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* State setters and the depth clear                                  */
  /* ------------------------------------------------------------------ */

  setCamera(camera: CameraState): void {
    this.assertPipelineOwned("setCamera");
    const copy: CameraState = {
      position: { ...camera.position },
      rotation: { ...camera.rotation },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    };
    this.sceneRecorder.recordCall("setCamera", [copy]);
    this.retainedCamera = copy;
    this.renderer.applyCamera(copy);
  }

  setLights(lights: readonly LightState[]): void {
    this.assertPipelineOwned("setLights");
    const copy = lights.map((light) => ({ ...light }));
    this.sceneRecorder.recordCall("setLights", [copy]);
    this.retainedLights = copy;
    this.renderer.applyLights(copy);
  }

  setMode(mode: RenderMode): void {
    this.assertPipelineOwned("setMode");
    requireMode(mode);
    this.sceneRecorder.recordCall("setMode", [mode]);
    this.retainedMode = mode;
    this.renderer.applyMode(mode);
  }

  clearDepth(): void {
    this.assertPipelineOwned("clearDepth");
    this.sceneRecorder.recordCall("clearDepth", []);
    this.renderer.clearDepthOp();
  }

  /* ------------------------------------------------------------------ */
  /* Draw calls                                                          */
  /* ------------------------------------------------------------------ */

  drawMesh(
    mesh: MeshHandle,
    transform: Transform,
    options?: DrawMeshOptions,
  ): void {
    this.assertInside("drawMesh");
    if (decodedMesh(mesh) === undefined) {
      throw new Error(
        "drawMesh was called with a value that is not a loaded mesh: a MeshHandle comes from the assets loader's loadMesh",
      );
    }
    const clip = options?.clip ?? null;
    if (clip !== null && !mesh.clips.includes(clip)) {
      throw new Error(
        `drawMesh was called with clip "${clip}", which mesh "${mesh.path}" does not carry: its clips are [${mesh.clips
          .map((name) => `"${name}"`)
          .join(", ")}]`,
      );
    }
    const args: unknown[] =
      options === undefined ? [mesh, transform] : [mesh, transform, options];
    this.sceneRecorder.recordCall("drawMesh", args);
    if (!isFiniteTransform(transform)) return;
    const clipTime = options?.clipTime ?? 0;
    const override =
      options?.material === undefined
        ? null
        : this.renderer.resolveMaterial(options.material);
    this.renderer.drawMesh(
      mesh,
      copyTransform(transform),
      override,
      clip,
      clipTime,
    );
  }

  drawGeometry(
    geometry: Geometry,
    material: MaterialLike,
    transform: Transform,
  ): void {
    this.assertInside("drawGeometry");
    if (!(geometry instanceof EngineGeometry)) {
      throw new Error(
        "drawGeometry was called with a value this scene context did not produce: a Geometry comes from the context's create* methods",
      );
    }
    this.sceneRecorder.recordCall("drawGeometry", [
      geometry,
      material,
      transform,
    ]);
    if (!isFiniteTransform(transform)) return;
    this.renderer.drawGeometry(
      geometry,
      this.renderer.resolveMaterial(material),
      copyTransform(transform),
    );
  }

  drawBillboard(texture: TextureHandle, position: Vec3, size: Vec2): void {
    this.assertInside("drawBillboard");
    this.sceneRecorder.recordCall("drawBillboard", [texture, position, size]);
    if (!isFiniteVec3(position) || !isFiniteVec2(size)) return;
    this.renderer.drawBillboard(texture, { ...position }, { ...size });
  }

  drawLine(points: readonly Vec3[], color: Color): void {
    this.assertInside("drawLine");
    this.sceneRecorder.recordCall("drawLine", [points, color]);
    for (const point of points) {
      if (!isFiniteVec3(point)) return;
    }
    this.renderer.drawLine(
      points.map((point) => ({ ...point })),
      color,
    );
  }

  drawHudText(text: string, position: Vec2, options?: HudTextOptions): void {
    this.assertInside("drawHudText");
    const args: unknown[] =
      options === undefined ? [text, position] : [text, position, options];
    this.sceneRecorder.recordCall("drawHudText", args);
    const size = options?.size ?? 24;
    if (!isFiniteVec2(position) || !Number.isFinite(size)) return;
    this.renderer.drawHudText(
      String(text),
      { ...position },
      {
        size,
        color: options?.color ?? "#ffffff",
        align: options?.align ?? "left",
      },
    );
  }

  drawHudRect(position: Vec2, size: Vec2, color: Color): void {
    this.assertInside("drawHudRect");
    this.sceneRecorder.recordCall("drawHudRect", [position, size, color]);
    if (!isFiniteVec2(position) || !isFiniteVec2(size)) return;
    this.renderer.drawHudRect({ ...position }, { ...size }, color);
  }

  /* ------------------------------------------------------------------ */
  /* Producers                                                           */
  /* ------------------------------------------------------------------ */

  createBox(size: Vec3): Geometry {
    this.assertInside("createBox");
    requirePositive("createBox", "size.x", size.x);
    requirePositive("createBox", "size.y", size.y);
    requirePositive("createBox", "size.z", size.z);
    const copy = { ...size };
    const data = cachedMeshData(`box:${copy.x}:${copy.y}:${copy.z}`, () =>
      buildBox(copy),
    );
    const geometry = new EngineGeometry(data, {
      min: { x: -copy.x / 2, y: -copy.y / 2, z: -copy.z / 2 },
      max: { x: copy.x / 2, y: copy.y / 2, z: copy.z / 2 },
    });
    this.sceneRecorder.registerResource(geometry, "createBox", [copy]);
    return geometry;
  }

  createSphere(radius: number): Geometry {
    this.assertInside("createSphere");
    requirePositive("createSphere", "radius", radius);
    const data = cachedMeshData(`sphere:${radius}`, () => buildSphere(radius));
    const geometry = new EngineGeometry(data, {
      min: { x: -radius, y: -radius, z: -radius },
      max: { x: radius, y: radius, z: radius },
    });
    this.sceneRecorder.registerResource(geometry, "createSphere", [radius]);
    return geometry;
  }

  createCylinder(radius: number, height: number): Geometry {
    this.assertInside("createCylinder");
    requirePositive("createCylinder", "radius", radius);
    requirePositive("createCylinder", "height", height);
    const data = cachedMeshData(`cylinder:${radius}:${height}`, () =>
      buildCylinder(radius, height),
    );
    const geometry = new EngineGeometry(data, {
      min: { x: -radius, y: -height / 2, z: -radius },
      max: { x: radius, y: height / 2, z: radius },
    });
    this.sceneRecorder.registerResource(geometry, "createCylinder", [
      radius,
      height,
    ]);
    return geometry;
  }

  createCapsule(radius: number, height: number): Geometry {
    this.assertInside("createCapsule");
    requirePositive("createCapsule", "radius", radius);
    requirePositive("createCapsule", "height", height);
    const data = cachedMeshData(`capsule:${radius}:${height}`, () =>
      buildCapsule(radius, height),
    );
    // The extent along the axis is height + 2 * radius, per the vocabulary.
    const geometry = new EngineGeometry(data, {
      min: { x: -radius, y: -(height / 2 + radius), z: -radius },
      max: { x: radius, y: height / 2 + radius, z: radius },
    });
    this.sceneRecorder.registerResource(geometry, "createCapsule", [
      radius,
      height,
    ]);
    return geometry;
  }

  createPlane(width: number, depth: number): Geometry {
    this.assertInside("createPlane");
    requirePositive("createPlane", "width", width);
    requirePositive("createPlane", "depth", depth);
    const data = cachedMeshData(`plane:${width}:${depth}`, () =>
      buildPlane(width, depth),
    );
    const geometry = new EngineGeometry(data, {
      min: { x: -width / 2, y: 0, z: -depth / 2 },
      max: { x: width / 2, y: 0, z: depth / 2 },
    });
    this.sceneRecorder.registerResource(geometry, "createPlane", [
      width,
      depth,
    ]);
    return geometry;
  }

  createMaterial(spec: MaterialSpec): Material {
    this.assertInside("createMaterial");
    requireUnit("roughness", spec.roughness);
    requireUnit("metallic", spec.metallic);
    requireUnit("opacity", spec.opacity);
    // The recipe records the spec as supplied — the same shallow copy the
    // material is built from — so two identical calls share one resource.
    const supplied: MaterialSpec = { ...spec };
    const material = new EngineMaterial(supplied);
    this.sceneRecorder.registerResource(material, "createMaterial", [supplied]);
    return material;
  }
}

function copyTransform(t: Transform): Transform {
  return {
    position: { ...t.position },
    rotation: { ...t.rotation },
    scale: { ...t.scale },
  };
}

/* -------------------------------------------------------------------------- */
/* The pipeline                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The two renderer switches, reached as `engine.renderer` and available from
 * construction. Both change what the pipeline draws rather than what a tick
 * computes; the next frame the pipeline runs draws under them.
 */
export interface Renderer {
  /** The mode in force, `standard` until it is set. */
  mode(): RenderMode;
  /** Sets the mode. The next frame the pipeline runs draws under it. */
  setMode(mode: RenderMode): void;
  /** Whether the collision overlay draws. */
  collisionOverlay(): boolean;
  /** Turns the collision overlay on or off. */
  setCollisionOverlay(enabled: boolean): void;
}

/**
 * What the pipeline needs from the open world's camera: the follow target, the
 * adoption call step 1 performs, and the state snapshot step 2 sets on the
 * scene context.
 *
 * Narrower than the `Camera` interface a game holds, and deliberately so:
 * `adopt` is engine wiring rather than part of the documented camera surface,
 * so the engine hands the pipeline the concrete `WorldCamera<Actor>` it built
 * beside the world, which satisfies this structurally.
 */
export interface PipelineCamera {
  readonly target: Actor | null;
  adopt(position: Vec3, rotation: Quat, fovY: number): void;
  snapshot(): CameraState;
}

/**
 * What the pipeline reads off the open world: the camera and the actor list in
 * spawn order.
 *
 * The two members alone rather than the `World` type, because the pipeline
 * pairs the world's actors with the camera the engine holds separately (see
 * {@link PipelineCamera}) and has no business reaching the rest of a world.
 */
export interface RenderWorld {
  readonly camera: PipelineCamera;
  /** Every actor still in the world, in spawn order — the pipeline reads `alive` itself. */
  actors(): readonly Actor[];
}

/** What the engine hands the pipeline to draw one frame from. */
export interface RenderScene {
  /** The world whose picture this frame is. */
  world: RenderWorld;
  /** The fit this frame renders through. */
  viewport: Viewport;
  /** The canvas backing store, in device pixels. */
  surface: { width: number; height: number };
  /** The loop's position, as `DrawApi.frame` reports it. */
  frame: FrameInfo;
  /** The color the canvas clears to, or `null` for transparency. */
  background: string | null;
}

/**
 * The collision overlay's view of one collider, duck-typed rather than
 * imported: the collision module carries its own component seam until
 * integration, and the overlay needs only the shape, the declared responses,
 * and the world transform.
 */
export interface OverlayCollider {
  readonly shape: Shape3;
  readonly responses: Readonly<Record<string, string>>;
  worldTransform(): Transform;
}

/** Whether a component is collider-shaped, whatever class tree it came from. */
function isOverlayCollider(
  component: object,
): component is OverlayCollider & { enabled: boolean } {
  const candidate = component as {
    shape?: { kind?: unknown };
    responses?: unknown;
    channel?: unknown;
    worldTransform?: unknown;
  };
  return (
    typeof candidate.worldTransform === "function" &&
    typeof candidate.channel === "string" &&
    candidate.responses !== null &&
    typeof candidate.responses === "object" &&
    (candidate.shape?.kind === "box" ||
      candidate.shape?.kind === "sphere" ||
      candidate.shape?.kind === "capsule")
  );
}

/**
 * The overlay palette: the color states the strongest response the collider's
 * own `responses` declare — `block` beats `overlap` beats none.
 */
function overlayColor(responses: Readonly<Record<string, string>>): Color {
  let sawOverlap = false;
  for (const answer of Object.values(responses)) {
    if (answer === "block") return "#ff4040";
    if (answer === "overlap") sawOverlap = true;
  }
  return sawOverlap ? "#40ff40" : "#808080";
}

/** One collected component, with the collection position as the sort tiebreak. */
interface Collected {
  component: RenderComponent;
  /** Position in spawn-then-attachment order, which the layer sort preserves. */
  order: number;
}

/** A closed circle of `segments` points in the plane spanned by `u` and `v`, at `center`. */
function circlePoints(
  center: Vec3,
  u: Vec3,
  v: Vec3,
  radius: number,
  segments: number,
): Vec3[] {
  const points: Vec3[] = [];
  for (let s = 0; s <= segments; s++) {
    const angle = (s / segments) * Math.PI * 2;
    const cos = Math.cos(angle) * radius;
    const sin = Math.sin(angle) * radius;
    points.push({
      x: center.x + u.x * cos + v.x * sin,
      y: center.y + u.y * cos + v.y * sin,
      z: center.z + u.z * cos + v.z * sin,
    });
  }
  return points;
}

/** The text height a size scale factor leaves visible: magnitudes, mirrored scales included. */
function axisScale(value: number): number {
  return Number.isFinite(value) ? Math.abs(value) : 1;
}

/**
 * The engine's implementation of the `Renderer` interface — the pipeline's two
 * switches — and the internal entry point the frame calls to draw.
 *
 * Internal: the engine alone constructs it, once, over the engine-owned scene
 * context and renderer, and it survives every level transition (the mode and
 * the overlay switch are engine state, not world state).
 */
export class RenderPipeline implements Renderer {
  private readonly scene: EngineSceneContext;
  private readonly renderer: SceneRenderer;

  private renderMode: RenderMode = "standard";
  private overlayEnabled = false;

  /**
   * Rasterized text billboards, keyed on string, fill, and baked alpha.
   * Bounded: a scoreboard lettering a new string every frame cycles the cache,
   * and a recording dedups a re-rasterized string on its content either way.
   */
  private readonly textTextures = new LruCache<RasterizedTexture>(256);

  constructor(scene: EngineSceneContext, renderer: SceneRenderer) {
    this.scene = scene;
    this.renderer = renderer;
  }

  /** The mode in force, `standard` until it is set. */
  mode(): RenderMode {
    return this.renderMode;
  }

  /** Sets the mode, refusing a value outside `RenderMode` by name. */
  setMode(mode: RenderMode): void {
    requireMode(mode);
    this.renderMode = mode;
  }

  /** Whether the collision overlay draws. */
  collisionOverlay(): boolean {
    return this.overlayEnabled;
  }

  /** Turns the collision overlay on or off. */
  setCollisionOverlay(enabled: boolean): void {
    this.overlayEnabled = enabled;
  }

  /**
   * Draw one frame: the documented eight steps, minus the diagnostics overlay,
   * which draws on its own surface outside the recorder's frame bracket.
   *
   * Internal: the engine calls it once per frame, after the ticks and after
   * any transition. Every recorded operation of the frame is issued in here,
   * between the engine's `openFrame` and `closeFrame`.
   */
  render(scene: RenderScene): void {
    // Step 1: a world following a view target adopts the target's first
    // enabled CameraComponent's world position, rotation, and fovY.
    this.updateCamera(scene.world);

    const camera = scene.world.camera.snapshot();
    // The mode is captured once per frame: a `setMode` on the switches waits
    // for the next frame, and `api.mode` agrees with every draw this one makes.
    const mode = this.renderMode;
    const actors = scene.world.actors().filter((actor) => actor.alive);

    this.scene.enterPipeline();
    try {
      // Step 2: the renderer state, set on the scene context — the mode, the
      // camera, and the lights, in that order — so a recording states what
      // framed and lit the frame.
      this.scene.setMode(mode);
      this.scene.setCamera(camera);
      this.scene.setLights(this.collectLights(actors));

      // Step 3: the clear, the depth reset, and the letterbox fit.
      this.renderer.beginFrame(scene.background, scene.viewport, scene.surface);

      // Steps 4 and 5: collect enabled, visible render components on live
      // actors, in spawn-then-attachment order, and sort stably by layer.
      const collected: Collected[] = [];
      for (const actor of actors) {
        for (const component of actor.components) {
          if (!(component instanceof RenderComponent)) continue;
          if (!component.enabled || !component.visible) continue;
          collected.push({ component, order: collected.length });
        }
      }
      collected.sort(
        (a, b) => a.component.layer - b.component.layer || a.order - b.order,
      );

      // Step 6: layers ascending, the depth buffer cleared before each layer
      // through the vocabulary, opaque components in sort order and the
      // sub-opacity ones afterwards, farthest from the camera first.
      const api = this.buildDrawApi(scene, camera, mode);
      let index = 0;
      while (index < collected.length) {
        const layer = collected[index]!.component.layer;
        const opaque: Collected[] = [];
        const translucent: { entry: Collected; distance: number }[] = [];
        while (
          index < collected.length &&
          collected[index]!.component.layer === layer
        ) {
          const entry = collected[index]!;
          if (clampOpacity(entry.component.opacity) < 1) {
            const at = entry.component.worldTransform().position;
            translucent.push({
              entry,
              distance: distanceBetween(camera.position, at),
            });
          } else {
            opaque.push(entry);
          }
          index++;
        }
        this.scene.clearDepth();
        for (const entry of opaque)
          this.drawOne(entry.component, api, camera, mode);
        translucent.sort((a, b) => b.distance - a.distance);
        for (const { entry } of translucent)
          this.drawOne(entry.component, api, camera, mode);
      }

      // Step 7: the collision overlay — a depth clear, then every enabled
      // collider's shape as wireframe outlines, a color per response, so
      // nothing the game drew hides it and a recording replays it exactly.
      if (this.overlayEnabled) this.drawCollisionOverlay(actors);
    } finally {
      this.scene.exitPipeline();
    }

    // The run's trailing translucent draws and the HUD composite close the
    // picture; the diagnostics overlay (step 8) is the engine's, on its own
    // surface, outside the pipeline and outside the recording.
    this.renderer.endFrame();
  }

  /* ------------------------------------------------------------------ */
  /* Steps                                                               */
  /* ------------------------------------------------------------------ */

  private updateCamera(world: RenderWorld): void {
    const target = world.camera.target;
    if (target === null || !target.alive) return;
    for (const component of target.components) {
      if (!(component instanceof CameraComponent) || !component.enabled)
        continue;
      const at = component.worldTransform();
      world.camera.adopt(at.position, at.rotation, component.fovY);
      return;
    }
  }

  /** Enabled lights on live actors, spawn then attachment order — or the default rig. */
  private collectLights(actors: readonly Actor[]): LightState[] {
    const lights: LightState[] = [];
    for (const actor of actors) {
      for (const component of actor.components) {
        if (component instanceof LightComponent && component.enabled) {
          lights.push(lightStateOf(component));
        }
      }
    }
    return lights.length > 0 ? lights : [...defaultLightRig()];
  }

  private buildDrawApi(
    scene: RenderScene,
    camera: CameraState,
    mode: RenderMode,
  ): DrawApi {
    const sceneContext = this.scene;
    const frame = { ...scene.frame };
    const viewport = { ...scene.viewport };
    return {
      scene: sceneContext,
      mode,
      frame: () => ({ ...frame }),
      viewport: () => ({ ...viewport }),
      camera: () => ({
        position: { ...camera.position },
        rotation: { ...camera.rotation },
        fovY: camera.fovY,
        near: camera.near,
        far: camera.far,
      }),
    };
  }

  /** Lower one component onto the vocabulary, in its place in the order. */
  private drawOne(
    component: RenderComponent,
    api: DrawApi,
    camera: CameraState,
    mode: RenderMode,
  ): void {
    if (component instanceof MeshComponent) {
      this.lowerMesh(component);
      return;
    }
    if (component instanceof ShapeComponent) {
      this.lowerShape(component);
      return;
    }
    if (component instanceof TextComponent) {
      this.lowerText(component, camera, mode);
      return;
    }
    if (component instanceof DrawComponent) {
      this.scene.enterComponentDraw();
      try {
        component.draw(api);
      } finally {
        this.scene.exitComponentDraw();
      }
    }
  }

  /**
   * A `MeshComponent`: `drawMesh` at the world transform. The tint and the
   * component's opacity fold into the material argument — the vocabulary's
   * one channel for them — through `createMaterial`, keeping the override
   * handle's base-color and normal maps where one is set. A component with no
   * tint at full opacity passes its override (or nothing) through untouched,
   * so the common case draws the file's own materials exactly.
   */
  private lowerMesh(component: MeshComponent): void {
    const opacity = clampOpacity(component.opacity);
    const transform = component.worldTransform();
    const options: DrawMeshOptions = {};
    if (component.clip !== null) {
      options.clip = component.clip;
      options.clipTime = component.clipTime;
    }
    if (component.color === null && opacity >= 1) {
      if (component.material !== null) options.material = component.material;
    } else {
      const spec: MaterialSpec = {
        baseColor: component.color ?? "#ffffff",
        opacity,
      };
      if (component.material !== null) {
        const base = component.material.maps.baseColor;
        const normal = component.material.maps.normal;
        if (base !== undefined) spec.baseColorMap = base;
        if (normal !== undefined) spec.normalMap = normal;
      }
      options.material = this.scene.createMaterial(spec);
    }
    if (Object.keys(options).length === 0) {
      this.scene.drawMesh(component.mesh, transform);
    } else {
      this.scene.drawMesh(component.mesh, transform, options);
    }
  }

  /**
   * A `ShapeComponent`: the documented scale rules applied to the shape, a
   * geometry produced through the vocabulary, and a `drawGeometry` at the
   * world position and rotation with unit scale — so the recorded call
   * carries exactly the primitive the scale rules produced.
   */
  private lowerShape(component: ShapeComponent): void {
    const opacity = clampOpacity(component.opacity);
    const transform = component.worldTransform();
    const shape = scaleShape3(component.shape, transform.scale);
    let geometry: Geometry;
    if (shape.kind === "box") {
      geometry = this.scene.createBox(safeSize(shape.size));
    } else if (shape.kind === "sphere") {
      geometry = this.scene.createSphere(safePositive(shape.radius));
    } else {
      geometry = this.scene.createCapsule(
        safePositive(shape.radius),
        safePositive(shape.height),
      );
    }
    let material: MaterialLike;
    if (component.material === null) {
      material =
        opacity >= 1
          ? component.color
          : this.scene.createMaterial({ baseColor: component.color, opacity });
    } else if (opacity >= 1 && isOpaqueWhite(component.color)) {
      material = component.material;
    } else {
      const spec: MaterialSpec = { baseColor: component.color, opacity };
      const base = component.material.maps.baseColor;
      const normal = component.material.maps.normal;
      if (base !== undefined) spec.baseColorMap = base;
      if (normal !== undefined) spec.normalMap = normal;
      material = this.scene.createMaterial(spec);
    }
    this.scene.drawGeometry(geometry, material, {
      position: transform.position,
      rotation: transform.rotation,
      scale: { x: 1, y: 1, z: 1 },
    });
  }

  /**
   * A `TextComponent`: the string rasterized in the engine's monospace face,
   * in `fill`, into a `text:`-pathed texture, issued as a `drawBillboard` — or,
   * under `wireframe`, the quad's outline as a `drawLine` loop in `fill`.
   * `align` and `baseline` offset the quad in the camera's own plane and are
   * not part of the texture, so alignment changes never re-rasterize.
   */
  private lowerText(
    component: TextComponent,
    camera: CameraState,
    mode: RenderMode,
  ): void {
    const transform = component.worldTransform();
    const size = textHeightOf(component.font);
    const chars = [...component.text].length;
    const width = (size / 2) * chars;
    const quadWidth = width * axisScale(transform.scale.x);
    const quadHeight = size * axisScale(transform.scale.y);

    const right = rotateVec3(camera.rotation, { x: 1, y: 0, z: 0 });
    const up = rotateVec3(camera.rotation, { x: 0, y: 1, z: 0 });
    const dx =
      component.align === "left"
        ? quadWidth / 2
        : component.align === "right"
          ? -quadWidth / 2
          : 0;
    const dy =
      component.baseline === "top"
        ? -quadHeight / 2
        : component.baseline === "bottom"
          ? quadHeight / 2
          : 0;
    const center: Vec3 = {
      x: transform.position.x + right.x * dx + up.x * dy,
      y: transform.position.y + right.y * dx + up.y * dy,
      z: transform.position.z + right.z * dx + up.z * dy,
    };

    if (mode === "wireframe") {
      const corner = (sx: number, sy: number): Vec3 => ({
        x:
          center.x +
          right.x * (quadWidth / 2) * sx +
          up.x * (quadHeight / 2) * sy,
        y:
          center.y +
          right.y * (quadWidth / 2) * sx +
          up.y * (quadHeight / 2) * sy,
        z:
          center.z +
          right.z * (quadWidth / 2) * sx +
          up.z * (quadHeight / 2) * sy,
      });
      const loop = [
        corner(-1, 1),
        corner(1, 1),
        corner(1, -1),
        corner(-1, -1),
        corner(-1, 1),
      ];
      this.scene.drawLine(loop, component.fill);
      return;
    }

    const fill = parseColor(component.fill);
    const alphaByte = Math.round(
      clampOpacity(component.opacity) * fill[3] * 255,
    );
    const key = `${alphaByte}\u0000${component.fill}\u0000${component.text}`;
    let texture = this.textTextures.get(key);
    if (texture === undefined) {
      texture = new RasterizedTexture(
        `text:${component.text}`,
        rasterizeText(component.text, [fill[0], fill[1], fill[2]], alphaByte),
      );
      this.textTextures.set(key, texture);
    }
    this.scene.drawBillboard(texture, center, { x: quadWidth, y: quadHeight });
  }

  /** Step 7: outlines for every enabled collider on a live actor, in the palette. */
  private drawCollisionOverlay(actors: readonly Actor[]): void {
    this.scene.clearDepth();
    for (const actor of actors) {
      for (const component of actor.components as readonly object[]) {
        if (!isOverlayCollider(component)) continue;
        if (!(component as { enabled?: boolean }).enabled) continue;
        const transform = component.worldTransform();
        const shape = scaleShape3(component.shape, transform.scale);
        const color = overlayColor(component.responses);
        for (const loop of this.outlineShape(shape, transform)) {
          this.scene.drawLine(loop, color);
        }
      }
    }
  }

  /** A shape's wireframe outline as world-space polylines, oriented by the transform. */
  private outlineShape(shape: Shape3, transform: Transform): Vec3[][] {
    const place = (local: Vec3): Vec3 => {
      const rotated = rotateVec3(transform.rotation, local);
      return {
        x: transform.position.x + rotated.x,
        y: transform.position.y + rotated.y,
        z: transform.position.z + rotated.z,
      };
    };
    const X: Vec3 = { x: 1, y: 0, z: 0 };
    const Y: Vec3 = { x: 0, y: 1, z: 0 };
    const Z: Vec3 = { x: 0, y: 0, z: 1 };
    const origin: Vec3 = { x: 0, y: 0, z: 0 };
    if (shape.kind === "box") {
      const hx = shape.size.x / 2;
      const hy = shape.size.y / 2;
      const hz = shape.size.z / 2;
      const c = (sx: number, sy: number, sz: number): Vec3 =>
        place({ x: hx * sx, y: hy * sy, z: hz * sz });
      const bottom = [
        c(-1, -1, -1),
        c(1, -1, -1),
        c(1, -1, 1),
        c(-1, -1, 1),
        c(-1, -1, -1),
      ];
      const top = [
        c(-1, 1, -1),
        c(1, 1, -1),
        c(1, 1, 1),
        c(-1, 1, 1),
        c(-1, 1, -1),
      ];
      return [
        bottom,
        top,
        [c(-1, -1, -1), c(-1, 1, -1)],
        [c(1, -1, -1), c(1, 1, -1)],
        [c(1, -1, 1), c(1, 1, 1)],
        [c(-1, -1, 1), c(-1, 1, 1)],
      ];
    }
    if (shape.kind === "sphere") {
      return [
        circlePoints(origin, X, Y, shape.radius, 32).map(place),
        circlePoints(origin, X, Z, shape.radius, 32).map(place),
        circlePoints(origin, Y, Z, shape.radius, 32).map(place),
      ];
    }
    const h = shape.height / 2;
    const r = shape.radius;
    // The two cap circles, plus a stadium profile in each axis plane.
    const profile = (u: Vec3): Vec3[] => {
      const points: Vec3[] = [];
      for (let s = 0; s <= 16; s++) {
        const angle = Math.PI - (s / 16) * Math.PI;
        points.push({
          x: u.x * Math.cos(angle) * r,
          y: h + Math.sin(angle) * r,
          z: u.z * Math.cos(angle) * r,
        });
      }
      for (let s = 0; s <= 16; s++) {
        const angle = -((s / 16) * Math.PI);
        points.push({
          x: u.x * Math.cos(angle) * r,
          y: -h + Math.sin(angle) * r,
          z: u.z * Math.cos(angle) * r,
        });
      }
      points.push(points[0]!);
      return points.map(place);
    };
    return [
      circlePoints({ x: 0, y: h, z: 0 }, X, Z, r, 32).map(place),
      circlePoints({ x: 0, y: -h, z: 0 }, X, Z, r, 32).map(place),
      profile({ x: 1, y: 0, z: 0 }),
      profile({ x: 0, y: 0, z: 1 }),
    ];
  }
}

/** The camera-to-draw distance the transparent pass sorts on. */
function distanceBetween(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** A producer refuses zero: a fully collapsed scale still draws a sliver rather than throwing. */
function safePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1e-6;
}

function safeSize(size: Vec3): Vec3 {
  return {
    x: safePositive(size.x),
    y: safePositive(size.y),
    z: safePositive(size.z),
  };
}

/** Whether a color parses to opaque white — the identity tint. */
function isOpaqueWhite(color: Color): boolean {
  const [r, g, b, a] = parseColor(color);
  return r === 1 && g === 1 && b === 1 && a === 1;
}
