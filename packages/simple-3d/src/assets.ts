/**
 * Asset loading: a game names a path, the engine decides the URL and hands back
 * a value the next line can use.
 *
 * Every path resolves under one fixed root (`assets/` by default). That is a
 * deliberate loss of freedom for the game — it cannot reach a CDN, a data URI or
 * a sibling directory — and it buys two things. A build's asset requests all land
 * somewhere a run's produced tree can be inspected, and one option relocates
 * every request at once, so the same game loads from a served page, from a build
 * output, or from a test process without editing a line of it. The rule is
 * enforced rather than assumed: a path with a leading slash, a `..` segment, or
 * a scheme is refused outright, because an escape hatch that only *some* builds
 * use makes the evidence unreadable.
 *
 * Four decisions shape the 3D loader, and each is a docs promise:
 *
 * - **The engine decodes its own formats.** A texture is a PNG and audio is a
 *   PCM WAV — the containers the asset-generation tools produce and the formats
 *   a recording re-embeds — and both are decoded by the pure decoders in
 *   `png.ts` and `wav.ts` rather than by a browser API, so a load resolves
 *   identically in a browser and in Node. `loadAudio` needs no audio context:
 *   headless it resolves an `AudioBuffer`-shaped value carrying the channel
 *   data, sample rate, and duration, and where the platform offers a real
 *   `AudioBuffer` the same decoded samples feed one.
 * - **There is no `loadImage`.** A texture is the 3D engine's image; a file the
 *   typed loaders do not cover — level data, a voxel rig, a font — goes through
 *   `load`, which keeps the root rule and the events without the engine having
 *   to know what the bytes mean.
 * - **A handle's readable fields are exactly what the docs list.** The decoded
 *   payload a draw or a capture needs — a texture's pixels, a mesh's bytes and
 *   parsed document — rides beside the handle in a module-level `WeakMap`
 *   rather than on it, reached through {@link textureSource},
 *   {@link meshSource}, and {@link materialSource}. The public value stays the
 *   documented shape, and dropping a handle drops its bytes with it.
 * - **The loader keeps no record, and a failure is both announced and thrown.**
 *   Every attempt is announced as an engine event at the moment it settles and
 *   then forgotten, so a long run's memory stays flat; the rejection is what
 *   the *game* needs, because a build that swallowed it would render nothing
 *   with no explanation.
 *
 * `MeshHandle`, `TextureHandle`, and `MaterialHandle` are declared here rather
 * than in `contract.ts` because the stage-0 contract module deliberately holds
 * the recording format alone; the package's entry point re-exports these types
 * so the docs' Exports section stays true.
 */

import type { MaterialMapSlot } from "./contract";
import type { Box3, Quat, Vec3 } from "./math";
import { decodePng } from "./png";
import { decodeWav, type DecodedWav } from "./wav";

/* -------------------------------------------------------------------------- */
/* Handles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A loaded glTF binary, ready to draw. An engine-owned, immutable value: the
 * game holds it in its state and hands it back to `drawMesh`, its identity is
 * the load that produced it, and its readable fields are exactly these.
 */
export interface MeshHandle {
  /** The path the handle was loaded from, as the game passed it. */
  readonly path: string;
  /** The mesh's axis-aligned bounds in its own local units. */
  readonly bounds: Box3;
  /** The named nodes the file carries, in file order. */
  readonly nodes: readonly string[];
  /** The named animation clips the file carries, in file order. */
  readonly clips: readonly string[];
}

/**
 * A decoded PNG, ready to use as a texture. Engine-owned and immutable, like
 * every handle; `drawBillboard` takes it, and a material's maps hold them.
 */
export interface TextureHandle {
  /** The path the handle was loaded from, as the game passed it. */
  readonly path: string;
  /** The decoded width in pixels. */
  readonly width: number;
  /** The decoded height in pixels. */
  readonly height: number;
}

/**
 * A loaded material document with every map it names, ready to slot in
 * wherever a material is accepted.
 */
export interface MaterialHandle {
  /** The path the handle was loaded from, as the game passed it. */
  readonly path: string;
  /** The loaded texture per map slot the document names. */
  readonly maps: Readonly<Partial<Record<MaterialMapSlot, TextureHandle>>>;
}

/* -------------------------------------------------------------------------- */
/* The side tables: what rides beside a handle                                */
/* -------------------------------------------------------------------------- */

/**
 * The loosely-typed JSON chunk of a glTF binary. Parsed defensively — every
 * field a reader touches is narrowed at the point of use — because the bytes
 * arrive from a produced file rather than from typed code. The index signature
 * is deliberate: the renderer reads accessors, buffer views, and materials this
 * module has no opinion about.
 */
export interface GltfJson {
  readonly [key: string]: unknown;
}

/** What rides beside a {@link MeshHandle}: the file, whole and parsed. */
export interface MeshSource {
  /** The `.glb` exactly as fetched — what a recording embeds as base64. */
  readonly bytes: Uint8Array;
  /** The parsed JSON chunk. */
  readonly json: GltfJson;
  /** The binary chunk, or `null` for a file that carries none. */
  readonly bin: Uint8Array | null;
}

/** What rides beside a {@link TextureHandle}: the pixels, and the file. */
export interface TextureSource {
  /**
   * The PNG exactly as fetched — what a recording embeds as a data URI — or
   * `null` for a texture the engine rasterized itself, which has pixels but
   * never had a file.
   */
  readonly bytes: Uint8Array | null;
  /** The decoded pixels, RGBA8, `width * height * 4` bytes, rows top-down. */
  readonly pixels: Uint8Array;
  /** The width in pixels, matching the handle. */
  readonly width: number;
  /** The height in pixels, matching the handle. */
  readonly height: number;
}

/** What rides beside a {@link MaterialHandle}: the document's own metadata. */
export interface MaterialSource {
  /** The document's suggested world-space tiling scale, or `null` when it names none. */
  readonly tiling: number | null;
  /** The maps' square resolution as the document states it, or `null`. */
  readonly size: number | null;
  /** The color space the document tags each map with, where it tags one. */
  readonly colorSpace: Readonly<
    Partial<Record<MaterialMapSlot, "srgb" | "linear">>
  >;
}

// WeakMaps rather than fields on the handle, so the handle's own shape stays
// exactly what the docs list, and module-level rather than per-loader, so the
// renderer and the recorder resolve a handle without holding the loader that
// made it. A collected handle takes its payload with it, which is what keeps
// "the loader keeps no record" true of the source tables too.
const meshSources = new WeakMap<MeshHandle, MeshSource>();
const textureSources = new WeakMap<TextureHandle, TextureSource>();
const materialSources = new WeakMap<MaterialHandle, MaterialSource>();

/** The decoded payload behind a mesh handle, or `undefined` for a value this engine never loaded. */
export function meshSource(mesh: MeshHandle): MeshSource | undefined {
  return meshSources.get(mesh);
}

/** The decoded payload behind a texture handle, or `undefined` for a value this engine never loaded. */
export function textureSource(
  texture: TextureHandle,
): TextureSource | undefined {
  return textureSources.get(texture);
}

/** The document metadata behind a material handle, or `undefined` for a value this engine never loaded. */
export function materialSource(
  material: MaterialHandle,
): MaterialSource | undefined {
  return materialSources.get(material);
}

/**
 * Enters an engine-made texture into the side table.
 *
 * The loader is not the only maker of textures: a pipeline that rasterizes
 * lettering into a billboard builds the pixels itself and still needs the
 * renderer and the recorder to resolve its handle through the one seam every
 * fetched texture already uses. Such a texture registers with `bytes: null`,
 * because it has pixels but never had a file.
 */
export function registerTexture(
  handle: TextureHandle,
  source: TextureSource,
): void {
  textureSources.set(handle, source);
}

/* -------------------------------------------------------------------------- */
/* Events and options                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The two events a load can announce, with their payloads. Declared here
 * rather than in `contract.ts` (which holds the recording format alone); the
 * engine's own event map composes this one.
 */
export interface AssetEventMap {
  "asset:loaded": { path: string; url: string };
  "asset:failed": { path: string; url: string; reason: string };
}

/**
 * How the loader announces an attempt.
 *
 * A plain function rather than an event-bus object: the loader needs to *say*
 * things, not to be subscribed to, and taking the narrowest thing that does the
 * job keeps this module a leaf that a test can drive with a two-line spy.
 */
export type AssetEventEmitter = <K extends keyof AssetEventMap>(
  event: K,
  payload: AssetEventMap[K],
) => void;

/** The directory every asset path is resolved under when none is given. */
const DEFAULT_ROOT = "assets/";

/**
 * Matches a leading URI scheme (`http:`, `data:`, `blob:`). Such a path names a
 * location outside the root as surely as a `..` segment does, so it is refused
 * on the same grounds.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** What an {@link AssetLoader} is built over. Every field has a working default. */
export interface AssetLoaderOptions {
  /** The root every path resolves under; defaults to `"assets/"`. */
  root?: string;
  /** The transport; defaults to the platform's `fetch`. */
  fetch?: (url: string) => Promise<Response>;
  /** Where the loader announces each attempt; defaults to announcing nowhere. */
  emit?: AssetEventEmitter;
}

/** The platform's `fetch`, wrapped so it is not called with a detached receiver. */
function defaultFetch(url: string): Promise<Response> {
  return globalThis.fetch(url);
}

/** The message an event's `reason` carries for a thrown value of any shape. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* -------------------------------------------------------------------------- */
/* Audio: decoded samples, shaped as an AudioBuffer                           */
/* -------------------------------------------------------------------------- */

/**
 * Wraps decoded WAV channels in the platform's own `AudioBuffer` where one
 * exists, and in an `AudioBuffer`-shaped value where none does.
 *
 * The docs promise that decoding needs no audio context and that a suite
 * awaits the same promises a browser build does. The `AudioBuffer` constructor
 * is present exactly where Web Audio is, so keying on it means a browser gets
 * the real node the audio graph can loop, while Node gets a structural
 * stand-in carrying the same channel data, sample rate, and duration — the
 * fields a validator reads. The stand-in implements the whole `AudioBuffer`
 * surface, so no caller can tell which branch it holds without playing it.
 */
function toAudioBuffer(decoded: DecodedWav): AudioBuffer {
  const frames = decoded.channels[0]?.length ?? 0;

  const ctor = (globalThis as { AudioBuffer?: typeof AudioBuffer }).AudioBuffer;
  if (ctor) {
    try {
      const buffer = new ctor({
        length: frames,
        numberOfChannels: decoded.channels.length,
        sampleRate: decoded.sampleRate,
      });
      decoded.channels.forEach((channel, index) => {
        // Copied into a fresh array: the DOM types require an
        // ArrayBuffer-backed Float32Array, and the decoder's view only
        // promises ArrayBufferLike.
        buffer.copyToChannel(new Float32Array(channel), index);
      });
      return buffer;
    } catch {
      // A platform buffer that refuses these figures — a zero-length clip, an
      // out-of-range sample rate — degrades to the shaped value rather than
      // failing a load the decoder already succeeded at.
    }
  }

  // Fresh ArrayBuffer-backed copies, both because the handle must own its
  // samples and because the `AudioBuffer` surface promises that backing.
  const channels: Float32Array<ArrayBuffer>[] = decoded.channels.map(
    (channel) => new Float32Array(channel),
  );
  const silent = new Float32Array(frames);
  const channelAt = (index: number): Float32Array<ArrayBuffer> =>
    // A real AudioBuffer throws on an out-of-range channel; the shaped value
    // answers silence instead, because nothing sounds headless anyway and a
    // throw here would make the two branches observably different.
    channels[index] ?? silent;

  return {
    sampleRate: decoded.sampleRate,
    length: frames,
    duration: decoded.duration,
    numberOfChannels: channels.length,
    getChannelData: channelAt,
    copyFromChannel(
      destination: Float32Array,
      channelNumber: number,
      bufferOffset = 0,
    ): void {
      const source = channelAt(channelNumber).subarray(bufferOffset);
      destination.set(source.subarray(0, destination.length));
    },
    copyToChannel(
      source: Float32Array,
      channelNumber: number,
      bufferOffset = 0,
    ): void {
      const target = channelAt(channelNumber);
      target.set(
        source.subarray(0, Math.max(target.length - bufferOffset, 0)),
        bufferOffset,
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* glTF binary parsing                                                        */
/* -------------------------------------------------------------------------- */

/** The GLB container magic, `glTF` read as a little-endian uint32. */
const GLB_MAGIC = 0x46546c67;
/** The JSON chunk type, `JSON` read as a little-endian uint32. */
const GLB_JSON = 0x4e4f534a;
/** The binary chunk type, `BIN\0` read as a little-endian uint32. */
const GLB_BIN = 0x004e4942;

/** `value` as a plain object, or `null` for anything else. */
function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

/** `value` as a finite number, or `null` for anything else. */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Splits a `.glb` into its parsed JSON chunk and its binary chunk.
 *
 * Refuses, by name, anything that is not a version-2 glTF binary: the docs'
 * outcome table promises "`loadMesh` on a body that is not a glTF binary
 * rejects with the decode error", and a named refusal is that error.
 */
function parseGlb(bytes: Uint8Array): {
  json: GltfJson;
  bin: Uint8Array | null;
} {
  if (bytes.length < 12) {
    throw new Error(
      "glb: the body is shorter than a GLB header: the file is not a glTF binary",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(
      "glb: the body does not open with the glTF magic: the file is not a glTF binary",
    );
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new Error(
      `glb: container version ${version} is not supported: only glTF 2.0 binaries are`,
    );
  }

  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;

  let at = 12;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at, true);
    const type = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + length > bytes.length) {
      throw new Error(
        "glb: a chunk runs past the end of the file: the file is truncated",
      );
    }
    if (type === GLB_JSON && json === null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(
          new TextDecoder().decode(bytes.subarray(start, start + length)),
        );
      } catch {
        throw new Error(
          "glb: the JSON chunk does not parse: the file is corrupt",
        );
      }
      const record = asRecord(parsed);
      if (record === null) {
        throw new Error(
          "glb: the JSON chunk is not an object: the file is corrupt",
        );
      }
      json = record;
    } else if (type === GLB_BIN && bin === null) {
      bin = bytes.subarray(start, start + length);
    }
    // Chunks are 4-byte aligned; a conforming writer pads, and rounding the
    // advance tolerates one that padded the length itself.
    at = start + length + ((4 - (length % 4)) % 4);
  }

  if (json === null) {
    throw new Error(
      "glb: the file carries no JSON chunk: the file is not a glTF binary",
    );
  }
  return { json, bin };
}

/** A 4×4 column-major matrix, the layout glTF itself uses. */
type Mat4 = Float64Array;

/** The identity matrix. */
function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** `a * b`, both column-major. */
function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
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

/** The matrix composing scale, then rotation, then translation — glTF's own TRS order. */
function mat4FromTrs(t: Vec3, r: Quat, s: Vec3): Mat4 {
  const { x, y, z, w } = r;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s.x;
  m[1] = 2 * (x * y + z * w) * s.x;
  m[2] = 2 * (x * z - y * w) * s.x;
  m[4] = 2 * (x * y - z * w) * s.y;
  m[5] = (1 - 2 * (x * x + z * z)) * s.y;
  m[6] = 2 * (y * z + x * w) * s.y;
  m[8] = 2 * (x * z + y * w) * s.z;
  m[9] = 2 * (y * z - x * w) * s.z;
  m[10] = (1 - 2 * (x * x + y * y)) * s.z;
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  m[15] = 1;
  return m;
}

/** Applies `m` to a point (w = 1). */
function mat4Apply(m: Mat4, p: Vec3): Vec3 {
  return {
    x: (m[0] ?? 0) * p.x + (m[4] ?? 0) * p.y + (m[8] ?? 0) * p.z + (m[12] ?? 0),
    y: (m[1] ?? 0) * p.x + (m[5] ?? 0) * p.y + (m[9] ?? 0) * p.z + (m[13] ?? 0),
    z:
      (m[2] ?? 0) * p.x + (m[6] ?? 0) * p.y + (m[10] ?? 0) * p.z + (m[14] ?? 0),
  };
}

/** Reads a fixed-length number array field, or `null` when it is absent or malformed. */
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

/** A node's local transform: its `matrix` when it carries one, its TRS otherwise. */
function nodeMatrix(node: Readonly<Record<string, unknown>>): Mat4 {
  const matrix = numbersOf(node["matrix"], 16);
  if (matrix !== null) return Float64Array.from(matrix);
  const t = numbersOf(node["translation"], 3) ?? [0, 0, 0];
  const r = numbersOf(node["rotation"], 4) ?? [0, 0, 0, 1];
  const s = numbersOf(node["scale"], 3) ?? [1, 1, 1];
  return mat4FromTrs(
    { x: t[0] ?? 0, y: t[1] ?? 0, z: t[2] ?? 0 },
    { x: r[0] ?? 0, y: r[1] ?? 0, z: r[2] ?? 0, w: r[3] ?? 1 },
    { x: s[0] ?? 1, y: s[1] ?? 1, z: s[2] ?? 1 },
  );
}

/** A growable box that starts empty and unions points in. */
interface BoundsAccumulator {
  min: Vec3 | null;
  max: Vec3 | null;
}

/** Unions one point into the accumulator. */
function accumulate(bounds: BoundsAccumulator, p: Vec3): void {
  if (bounds.min === null || bounds.max === null) {
    bounds.min = { ...p };
    bounds.max = { ...p };
    return;
  }
  bounds.min.x = Math.min(bounds.min.x, p.x);
  bounds.min.y = Math.min(bounds.min.y, p.y);
  bounds.min.z = Math.min(bounds.min.z, p.z);
  bounds.max.x = Math.max(bounds.max.x, p.x);
  bounds.max.y = Math.max(bounds.max.y, p.y);
  bounds.max.z = Math.max(bounds.max.z, p.z);
}

/**
 * The local box of one mesh: the union of its primitives' POSITION accessor
 * `min`/`max` pairs, which glTF requires every exporter to write. A primitive
 * without a POSITION contributes nothing; an accessor without its bounds is a
 * file this decoder refuses by name rather than one it reads the buffers for,
 * because the pair is mandatory in the format and its absence marks a body
 * that is not the exporter's output.
 */
function meshBox(
  mesh: Readonly<Record<string, unknown>>,
  accessors: readonly unknown[],
  meshIndex: number,
): Box3 | null {
  const primitives = Array.isArray(mesh["primitives"])
    ? mesh["primitives"]
    : [];
  const bounds: BoundsAccumulator = { min: null, max: null };

  for (const primitive of primitives) {
    const record = asRecord(primitive);
    const attributes = record === null ? null : asRecord(record["attributes"]);
    const position =
      attributes === null ? null : asNumber(attributes["POSITION"]);
    if (position === null) continue;

    const accessor = asRecord(accessors[position]);
    const min = accessor === null ? null : numbersOf(accessor["min"], 3);
    const max = accessor === null ? null : numbersOf(accessor["max"], 3);
    if (min === null || max === null) {
      throw new Error(
        `glb: the POSITION accessor of mesh ${meshIndex} carries no min/max bounds: glTF requires them, so re-export the mesh`,
      );
    }
    accumulate(bounds, { x: min[0] ?? 0, y: min[1] ?? 0, z: min[2] ?? 0 });
    accumulate(bounds, { x: max[0] ?? 0, y: max[1] ?? 0, z: max[2] ?? 0 });
  }

  return bounds.min === null || bounds.max === null
    ? null
    : { min: bounds.min, max: bounds.max };
}

/** The eight corners of a box. */
function corners(box: Box3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) out.push({ x, y, z });
  return out;
}

/**
 * The mesh's axis-aligned bounds in its own local units: the union over the
 * default scene's node instances of each instanced mesh's box, with the node
 * hierarchy's transforms applied — the box the file draws into under an
 * identity `drawMesh` transform. A file whose scene instances nothing falls
 * back to the union of its meshes' raw boxes, and a file with no geometry at
 * all bounds to a point at the origin, which is at least honestly empty.
 */
function documentBounds(json: GltfJson): Box3 {
  const nodes = Array.isArray(json["nodes"]) ? json["nodes"] : [];
  const meshes = Array.isArray(json["meshes"]) ? json["meshes"] : [];
  const accessors = Array.isArray(json["accessors"]) ? json["accessors"] : [];

  const boxes: (Box3 | null)[] = meshes.map((mesh, index) => {
    const record = asRecord(mesh);
    return record === null ? null : meshBox(record, accessors, index);
  });

  const bounds: BoundsAccumulator = { min: null, max: null };

  const walk = (index: number, parent: Mat4, onPath: Set<number>): void => {
    // glTF is a tree by specification; the guard keeps a malformed file from
    // walking this loader in a circle.
    if (onPath.has(index)) return;
    const node = asRecord(nodes[index]);
    if (node === null) return;

    onPath.add(index);
    const world = mat4Multiply(parent, nodeMatrix(node));

    const mesh = asNumber(node["mesh"]);
    const box = mesh === null ? null : (boxes[mesh] ?? null);
    if (box !== null)
      for (const corner of corners(box))
        accumulate(bounds, mat4Apply(world, corner));

    const children = Array.isArray(node["children"]) ? node["children"] : [];
    for (const child of children) {
      const at = asNumber(child);
      if (at !== null) walk(at, world, onPath);
    }
    onPath.delete(index);
  };

  // The default scene's roots, where a scene exists; otherwise every node that
  // no other node claims as a child, which is what "the file's own picture"
  // means for a sceneless document.
  const scenes = Array.isArray(json["scenes"]) ? json["scenes"] : [];
  const sceneIndex = asNumber(json["scene"]) ?? 0;
  const scene = asRecord(scenes[sceneIndex]);
  let roots: number[] = [];
  if (scene !== null && Array.isArray(scene["nodes"])) {
    roots = scene["nodes"].map(asNumber).filter((n): n is number => n !== null);
  } else if (nodes.length > 0) {
    const claimed = new Set<number>();
    for (const node of nodes) {
      const record = asRecord(node);
      const children =
        record !== null && Array.isArray(record["children"])
          ? record["children"]
          : [];
      for (const child of children) {
        const at = asNumber(child);
        if (at !== null) claimed.add(at);
      }
    }
    roots = nodes
      .map((_, index) => index)
      .filter((index) => !claimed.has(index));
  }

  for (const root of roots) walk(root, mat4Identity(), new Set());

  if (bounds.min === null || bounds.max === null) {
    // Nothing instanced: fall back to the raw mesh boxes, so a library file
    // that only defines meshes still reports the size of what it defines.
    for (const box of boxes) {
      if (box === null) continue;
      accumulate(bounds, box.min);
      accumulate(bounds, box.max);
    }
  }

  return bounds.min === null || bounds.max === null
    ? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } }
    : { min: bounds.min, max: bounds.max };
}

/** The non-empty `name` strings of a glTF array, in file order. */
function namesOf(entries: unknown): readonly string[] {
  if (!Array.isArray(entries)) return [];
  const out: string[] = [];
  for (const entry of entries) {
    const record = asRecord(entry);
    const name = record === null ? null : record["name"];
    if (typeof name === "string" && name !== "") out.push(name);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Material documents                                                         */
/* -------------------------------------------------------------------------- */

/** The seven slots a material document may name a map for. */
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
 * The slot a document's map name binds to, or `null` for a name the engine
 * does not know. The assembly tool writes kebab-case channel names
 * (`base-color`); the engine's slot union is camelCase; both spellings are one
 * slot, so a produced document and a hand-written one read the same.
 */
function slotOf(name: string): MaterialMapSlot | null {
  if (name === "base-color") return "baseColor";
  return (MATERIAL_SLOTS as readonly string[]).includes(name)
    ? (name as MaterialMapSlot)
    : null;
}

/** One map entry of a parsed material document. */
interface ParsedMap {
  readonly slot: MaterialMapSlot;
  readonly path: string;
  readonly colorSpace: "srgb" | "linear" | null;
}

/** A parsed, validated material document. */
interface ParsedMaterial {
  readonly maps: readonly ParsedMap[];
  readonly tiling: number | null;
  readonly size: number | null;
}

/**
 * Parses and validates a material document's JSON text.
 *
 * The required fields are the `maps` array and, per entry, a string `name` the
 * engine knows a slot for and a string `path`; the docs' outcome table calls a
 * document missing them a decode error, so each refusal here names what is
 * missing and where. `tiling` and `size` are advisory and travel to the
 * {@link MaterialSource} side table rather than the handle.
 */
function parseMaterial(path: string, text: string): ParsedMaterial {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(
      `material document "${path}" is not JSON: the body does not parse`,
    );
  }
  const record = asRecord(parsed);
  if (record === null) {
    throw new Error(
      `material document "${path}" is missing its required fields: the body is not a JSON object`,
    );
  }
  const maps = record["maps"];
  if (!Array.isArray(maps)) {
    throw new Error(
      `material document "${path}" is missing its required fields: it carries no "maps" array`,
    );
  }

  const seen = new Set<MaterialMapSlot>();
  const out: ParsedMap[] = [];
  maps.forEach((entry, index) => {
    const map = asRecord(entry);
    const name = map === null ? null : map["name"];
    const mapPath = map === null ? null : map["path"];
    if (
      typeof name !== "string" ||
      typeof mapPath !== "string" ||
      mapPath === ""
    ) {
      throw new Error(
        `material document "${path}" is missing its required fields: maps[${index}] needs a string "name" and a string "path"`,
      );
    }
    const slot = slotOf(name);
    if (slot === null) {
      throw new Error(
        `material document "${path}" names an unknown map "${name}": the channels are base-color, normal, roughness, metallic, ao, emissive, and height`,
      );
    }
    if (seen.has(slot)) {
      throw new Error(
        `material document "${path}" names the "${name}" map twice: each channel carries one map`,
      );
    }
    seen.add(slot);
    const space = map === null ? null : map["colorSpace"];
    out.push({
      slot,
      path: mapPath,
      colorSpace: space === "srgb" || space === "linear" ? space : null,
    });
  });

  return {
    maps: out,
    tiling: asNumber(record["tiling"]),
    size: asNumber(record["size"]),
  };
}

/* -------------------------------------------------------------------------- */
/* The loader                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Resolves and loads a game's assets under a fixed root, announcing every
 * attempt.
 *
 * Every collaborator is injected: the fetcher so the loader can be driven
 * without a server (and so a failure a real network cannot be asked for on
 * demand can be produced at will), the root so the engine rather than this
 * class owns the convention, and the emitter so this module stays a leaf.
 * Decoding is the pure decoders' business, so no environment is consulted:
 * the same bytes decode to the same handle in a browser and in Node.
 */
export class AssetLoader {
  private readonly root: string;
  private readonly fetcher: (url: string) => Promise<Response>;
  private readonly emit: AssetEventEmitter;

  constructor(options: AssetLoaderOptions = {}) {
    const root = options.root ?? DEFAULT_ROOT;
    // Normalising the trailing slash here means the root can be written either
    // way at the call site and `resolve` stays a plain concatenation. An empty
    // root is left empty: it means "beside the page", and appending a slash
    // would silently turn every path absolute.
    this.root = root === "" || root.endsWith("/") ? root : `${root}/`;
    this.fetcher = options.fetch ?? defaultFetch;
    this.emit = options.emit ?? (() => {});
  }

  /**
   * Turns a game-supplied path into the URL it loads from, throwing if the path
   * would escape the asset root.
   *
   * Pure: it neither fetches nor announces anything, so a game that hands a URL
   * to an `<img>` or a stylesheet rather than fetching it does not invent an
   * event for a load this loader never performed. The events stay a record of
   * what the engine itself did.
   */
  resolve(path: string): string {
    if (path === "") {
      throw new Error("asset path is empty");
    }
    if (path.startsWith("/")) {
      throw new Error(
        `asset path "${path}" escapes the asset root "${this.root}": paths are relative to the root, so it must not start with "/"`,
      );
    }
    if (SCHEME.test(path)) {
      throw new Error(
        `asset path "${path}" escapes the asset root "${this.root}": an absolute URL is not an asset path`,
      );
    }
    if (path.split("/").includes("..")) {
      throw new Error(
        `asset path "${path}" escapes the asset root "${this.root}": a ".." segment is not allowed`,
      );
    }
    return `${this.root}${path}`;
  }

  /**
   * Loads an asset and hands back the response body untouched.
   *
   * This is the loader for a kind of file the engine has no opinion about —
   * level data, a voxel rig, a font. The root rule and the events apply exactly
   * as they do to the typed loaders, so a build's level data is as visible as
   * its textures.
   */
  load(path: string): Promise<Blob> {
    return this.attempt(path, (blob) => Promise.resolve(blob));
  }

  /**
   * Loads a PNG and decodes it to a {@link TextureHandle} ready to use as a
   * texture. The decoded pixels and the file's own bytes ride beside the
   * handle, reached through {@link textureSource}.
   */
  loadTexture(path: string): Promise<TextureHandle> {
    return this.attempt(path, async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const image = decodePng(bytes);
      const handle: TextureHandle = Object.freeze({
        path,
        width: image.width,
        height: image.height,
      });
      textureSources.set(handle, {
        bytes,
        pixels: image.pixels,
        width: image.width,
        height: image.height,
      });
      return handle;
    });
  }

  /**
   * Loads a glTF binary and decodes it to a {@link MeshHandle} ready to draw.
   *
   * The handle carries the facts a game plans around — the local bounds, the
   * named nodes, the named clips, each in file order — and the parsed document
   * with the file's own bytes ride beside it, reached through
   * {@link meshSource}, for the renderer that poses it and the recorder that
   * embeds it.
   */
  loadMesh(path: string): Promise<MeshHandle> {
    return this.attempt(path, async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { json, bin } = parseGlb(bytes);
      const bounds = documentBounds(json);
      const handle: MeshHandle = Object.freeze({
        path,
        bounds: Object.freeze({
          min: Object.freeze(bounds.min),
          max: Object.freeze(bounds.max),
        }),
        nodes: Object.freeze([...namesOf(json["nodes"])]),
        clips: Object.freeze([...namesOf(json["animations"])]),
      });
      meshSources.set(handle, { bytes, json, bin });
      return handle;
    });
  }

  /**
   * Loads a material document and every map it names, in one call and one
   * event, resolving to a {@link MaterialHandle}.
   *
   * The document names each map by a path relative to its own directory under
   * the asset root, so a material and its textures travel as one folder. The
   * map fetches happen inside this call and announce nothing of their own —
   * the event's `path` and `url` are the document's — and a map that fails
   * fails the whole load with an error naming the map, because a material
   * missing one of its textures is not the surface the document describes.
   */
  loadMaterial(path: string): Promise<MaterialHandle> {
    return this.attempt(path, async (blob) => {
      const parsed = parseMaterial(path, await blob.text());

      // "materials/hull/material.json" → "materials/hull/": the directory the
      // document's own map paths are relative to.
      const directory = path.slice(0, path.lastIndexOf("/") + 1);

      const maps: Partial<Record<MaterialMapSlot, TextureHandle>> = {};
      const colorSpace: Partial<Record<MaterialMapSlot, "srgb" | "linear">> =
        {};

      // In document order rather than in parallel, so which map a
      // multi-failure document is reported against is a fact about the
      // document rather than about network timing.
      for (const map of parsed.maps) {
        maps[map.slot] = await this.loadMap(directory, map);
        if (map.colorSpace !== null) colorSpace[map.slot] = map.colorSpace;
      }

      const handle: MaterialHandle = Object.freeze({
        path,
        maps: Object.freeze(maps),
      });
      materialSources.set(handle, {
        tiling: parsed.tiling,
        size: parsed.size,
        colorSpace: Object.freeze(colorSpace),
      });
      return handle;
    });
  }

  /**
   * Loads a PCM WAV and decodes it to an `AudioBuffer` ready to play.
   *
   * The engine decodes the WAV itself, so no audio context is consulted and
   * the promise resolves identically in a browser and in Node: headless, the
   * buffer is an `AudioBuffer`-shaped value carrying the channel data, sample
   * rate, and duration, and where the platform has a real `AudioBuffer` the
   * same samples feed one.
   */
  loadAudio(path: string): Promise<AudioBuffer> {
    return this.attempt(path, async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return toAudioBuffer(decodeWav(bytes));
    });
  }

  /**
   * Fetches and decodes one of a material document's maps, with every failure
   * renamed after the map.
   *
   * The rejection is "the map's error": an `Error` whose message names the
   * slot, the document-relative path, and what went wrong, with the underlying
   * failure as its `cause`. That message is also what the document's
   * `asset:failed` event carries as its `reason`, which is the outcome table's
   * "reason naming the map".
   */
  private async loadMap(
    directory: string,
    map: ParsedMap,
  ): Promise<TextureHandle> {
    const relative = `${directory}${map.path}`;
    try {
      const url = this.resolve(relative);
      const response = await this.fetcher(url);
      if (!response.ok) {
        throw new Error(
          `asset "${relative}" failed to load from "${url}": HTTP ${response.status}`,
        );
      }
      const bytes = new Uint8Array(await (await response.blob()).arrayBuffer());
      const image = decodePng(bytes);
      const handle: TextureHandle = Object.freeze({
        path: relative,
        width: image.width,
        height: image.height,
      });
      textureSources.set(handle, {
        bytes,
        pixels: image.pixels,
        width: image.width,
        height: image.height,
      });
      return handle;
    } catch (error) {
      throw new Error(
        `material map "${map.slot}" ("${map.path}") failed to load: ${reasonOf(error)}`,
        { cause: error },
      );
    }
  }

  /**
   * The shared body of every loader: resolve, fetch, decode, announce once.
   *
   * Every loader routes through here so a path refused by one is refused
   * identically by all of them, and so the "exactly one event per call" rule is
   * a property of one function rather than a convention five of them keep.
   *
   * The success event is emitted *after* the try block on purpose. Emitting it
   * inside would let a subscriber that throws turn a load that succeeded into
   * one that also reported a failure, which is the one shape an observer must
   * never have to reason about.
   */
  private async attempt<T>(
    path: string,
    decode: (blob: Blob) => Promise<T>,
  ): Promise<T> {
    let url: string;
    try {
      url = this.resolve(path);
    } catch (error) {
      // A refused path has no URL by definition, and an empty one is the
      // unambiguous signature of a path the engine rejected rather than a file
      // that resolved and was missing.
      this.emit("asset:failed", { path, url: "", reason: reasonOf(error) });
      throw error;
    }

    let value: T;
    try {
      const response = await this.fetcher(url);
      if (!response.ok) {
        throw new Error(
          `asset "${path}" failed to load from "${url}": HTTP ${response.status}`,
        );
      }
      value = await decode(await response.blob());
    } catch (error) {
      // Rejections travel unchanged rather than wrapped, so the caller sees the
      // real cause — the HTTP status, the network error, the decode error —
      // while the event keeps its uniform shape.
      this.emit("asset:failed", { path, url, reason: reasonOf(error) });
      throw error;
    }

    this.emit("asset:loaded", { path, url });
    return value;
  }
}
