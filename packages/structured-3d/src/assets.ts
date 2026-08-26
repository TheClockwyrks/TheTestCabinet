/**
 * Asset loading: a game names a path, the engine decides the URL — and decodes
 * the bytes itself.
 *
 * Every path resolves under one fixed root (`assets/` by default). That is a
 * deliberate loss of freedom for the game — it cannot reach a CDN, a data URI or
 * a sibling directory — and it buys two things. A build's asset requests all land
 * somewhere a run's produced tree can be inspected, and one option relocates
 * every request at once, so the same game loads from a served page, from a build
 * output, or from a test process without editing a line of it.
 *
 * The rule is enforced rather than assumed: a path with a leading slash, a `..`
 * segment, or a scheme is refused outright. Anything else would let a game
 * silently opt out of the root, and an escape hatch that only *some* builds use
 * makes the evidence unreadable.
 *
 * Two further shapes are worth stating outright, because both are departures from
 * what a loader usually looks like:
 *
 * - **The loader keeps no record.** Every attempt is announced as an engine event
 *   at the moment it settles, and the loader forgets it. An observer subscribes
 *   before initialization — it can, because the engine exists before any game code
 *   runs — and keeps exactly what it needs. Nothing here grows with the number of
 *   loads, so a long run's memory stays flat.
 * - **A failure is both announced and thrown.** The event is what an observer
 *   reads; the rejection is what the *game* needs, because a build that swallowed
 *   it would render nothing with no explanation. A game that treats a missing file
 *   as fatal lets the rejection escape its `initialize`, and a game with a
 *   fallback catches it — the decision is made once, not on every frame.
 *
 * Decoding lives here rather than in the game, and — unlike the 2D engines —
 * rather than in the platform: a texture is a PNG and audio is a PCM WAV, the
 * containers the asset-generation tools produce, and the engine decodes both
 * itself through `png.ts` and `wav.ts`, so a load resolves identically in a
 * browser and in Node. A mesh is a glTF binary (`.glb`) decoded to a
 * `MeshHandle` ready to draw, and a material is a document naming its maps,
 * loaded as one call and one event. There is no `loadImage`: a texture is the
 * 3D engine's image, and a file the typed loaders do not cover — level data, a
 * voxel `rig.json`, a font — goes through the generic `load`.
 *
 * A handle is an engine-owned value: immutable, identified by the load that
 * produced it. The decoded payload behind each handle (pixels, glTF chunks,
 * samples) is parked in module-level `WeakMap`s the renderer reads through
 * {@link decodedTexture} and {@link decodedMesh}, so the public handle stays
 * exactly the documented plain shape and the payload dies with the handle.
 */

import type { MaterialMapSlot } from "./contract";
import type { Box3, Quat, Transform, Vec3 } from "./math";
import { transformPoint } from "./math";
import { decodePng, type DecodedPng } from "./png";
import { decodeWav } from "./wav";
import type { EngineEventMap } from "./worlds";

export type { MaterialMapSlot } from "./contract";

/* -------------------------------------------------------------------------- */
/* Handles                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A loaded glTF binary, ready to hand to a `MeshComponent` or a scene-context
 * `drawMesh`. Its identity is the load that produced it, and it is immutable.
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

/** A decoded PNG, ready to use as a texture. */
export interface TextureHandle {
  /** The path the handle was loaded from, as the game passed it. */
  readonly path: string;
  /** The decoded width in pixels. */
  readonly width: number;
  /** The decoded height in pixels. */
  readonly height: number;
}

/** A parsed material document with every map it names already loaded. */
export interface MaterialHandle {
  /** The path the handle was loaded from, as the game passed it. */
  readonly path: string;
  /** The loaded texture per map slot the document names. */
  readonly maps: Readonly<Partial<Record<MaterialMapSlot, TextureHandle>>>;
}

/* -------------------------------------------------------------------------- */
/* The decoded payloads behind the handles                                    */
/* -------------------------------------------------------------------------- */

/**
 * A decoded glTF binary: the parsed JSON chunk and the binary chunk's bytes.
 *
 * Deliberately the file's own two halves rather than a re-modelled scene
 * graph: the renderer owns what geometry means (attributes, skins, clip
 * posing), and handing it the chunks keeps this module from freezing a
 * geometry model the rendering pipeline would immediately have to work
 * around. The loader reads only what the handle's documented fields need —
 * names, animations, and the POSITION bounds.
 */
export interface DecodedGlb {
  /** The parsed JSON chunk, as the file carries it. */
  readonly json: GlbJson;
  /** The binary chunk's bytes, or an empty array for a file without one. */
  readonly bin: Uint8Array;
}

/** The slice of a glTF document this package reads. Everything else passes through untouched. */
export interface GlbJson {
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly GlbNode[];
  readonly meshes?: readonly GlbMesh[];
  readonly accessors?: readonly GlbAccessor[];
  readonly bufferViews?: readonly GlbBufferView[];
  readonly animations?: readonly { readonly name?: string }[];
  readonly [key: string]: unknown;
}

/** One glTF node: a name, an optional mesh, children, and a TRS or matrix. */
export interface GlbNode {
  readonly name?: string;
  readonly mesh?: number;
  readonly children?: readonly number[];
  readonly matrix?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly [key: string]: unknown;
}

/** One glTF mesh: its primitives, each with named attribute accessors. */
export interface GlbMesh {
  readonly name?: string;
  readonly primitives?: readonly {
    readonly attributes?: Readonly<Record<string, number>>;
    readonly [key: string]: unknown;
  }[];
  readonly [key: string]: unknown;
}

/** One glTF accessor, as far as the bounds walk reads it. */
export interface GlbAccessor {
  readonly bufferView?: number;
  readonly byteOffset?: number;
  readonly componentType?: number;
  readonly count?: number;
  readonly type?: string;
  readonly min?: readonly number[];
  readonly max?: readonly number[];
  readonly [key: string]: unknown;
}

/** One glTF buffer view into the binary chunk. */
export interface GlbBufferView {
  readonly buffer?: number;
  readonly byteOffset?: number;
  readonly byteLength?: number;
  readonly byteStride?: number;
  readonly [key: string]: unknown;
}

/**
 * The decoded payloads, keyed by handle identity. Module-level `WeakMap`s
 * rather than fields on the handles, so the public handle is exactly the
 * documented plain shape (a game can log or snapshot one without dragging
 * megabytes of pixels along) and the payload is collected with the handle. A
 * `WeakMap` also keeps the loader's own state flat: nothing here grows with
 * the number of loads a run performs.
 */
const TEXTURE_PIXELS = new WeakMap<TextureHandle, DecodedPng>();
const MESH_DATA = new WeakMap<MeshHandle, DecodedGlb>();

/**
 * The decoded pixels behind a texture handle, for the rendering pipeline's
 * `texImage2D` upload. `undefined` for an object this loader did not produce.
 */
export function decodedTexture(handle: TextureHandle): DecodedPng | undefined {
  return TEXTURE_PIXELS.get(handle);
}

/**
 * The decoded glTF chunks behind a mesh handle, for the rendering pipeline's
 * geometry extraction. `undefined` for an object this loader did not produce.
 */
export function decodedMesh(handle: MeshHandle): DecodedGlb | undefined {
  return MESH_DATA.get(handle);
}

/* -------------------------------------------------------------------------- */
/* The AudioBuffer-shaped decoded clip                                        */
/* -------------------------------------------------------------------------- */

/**
 * An `AudioBuffer`-shaped value carrying decoded PCM: channel data, sample
 * rate, and duration.
 *
 * The docs promise that decoding needs no audio context — `loadAudio` resolves
 * the decoded buffer whether or not a context exists — so the loader cannot
 * lean on `decodeAudioData`. Headless this value *is* the result; where a real
 * `AudioContext` exists, the audio bus copies the same samples into a native
 * `AudioBuffer` before playing. Only the members Web Audio consumers actually
 * read are implemented; anything else a caller reaches for is a property that
 * does not exist rather than one that lies.
 */
export class PcmAudioBuffer {
  /** The sample rate, in frames per second. */
  readonly sampleRate: number;
  /** The clip's length in frames per channel. */
  readonly length: number;
  /** How many channels the clip carries. */
  readonly numberOfChannels: number;
  /** The clip's length in seconds: frames divided by the sample rate. */
  readonly duration: number;

  private readonly channels: readonly Float32Array[];

  constructor(sampleRate: number, channels: readonly Float32Array[]) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.numberOfChannels = channels.length;
    this.length = channels[0]?.length ?? 0;
    this.duration = sampleRate > 0 ? this.length / sampleRate : 0;
  }

  /**
   * The channel's samples, in `-1..1`. The live array rather than a copy —
   * the same contract a native `AudioBuffer` keeps.
   */
  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) {
      throw new RangeError(
        `channel ${channel} is out of range: this buffer has ${this.numberOfChannels}`,
      );
    }
    return data;
  }

  /** Copies a channel into `destination`, from `startInChannel`. */
  copyFromChannel(
    destination: Float32Array,
    channel: number,
    startInChannel = 0,
  ): void {
    const data = this.getChannelData(channel);
    destination.set(
      data.subarray(startInChannel, startInChannel + destination.length),
    );
  }

  /** Copies `source` into a channel, at `startInChannel`. */
  copyToChannel(
    source: Float32Array,
    channel: number,
    startInChannel = 0,
  ): void {
    this.getChannelData(channel).set(source, startInChannel);
  }
}

/* -------------------------------------------------------------------------- */
/* The loader                                                                 */
/* -------------------------------------------------------------------------- */

/** The directory every asset path is resolved under when none is given. */
const DEFAULT_ROOT = "assets/";

/**
 * Matches a leading URI scheme (`http:`, `data:`, `blob:`). Such a path names a
 * location outside the root as surely as a `..` segment does, so it is refused on
 * the same grounds.
 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The two events a load can announce, with the payloads the engine map carries. */
export type AssetEventName = "asset:loaded" | "asset:failed";

/** Those two events with their payloads — what a spy in a test collects. */
export type AssetEventMap = Pick<EngineEventMap, AssetEventName>;

/**
 * How the loader announces an attempt.
 *
 * A plain function rather than an event-bus object: the loader needs to *say*
 * things, not to be subscribed to, and taking the narrowest thing that does the
 * job keeps this module a leaf that a test can drive with a two-line spy. The
 * payload map is declared here and matched structurally by the engine's own
 * `EngineEventMap`, so the emitter the engine injects typechecks against both.
 */
export type AssetEventEmitter = <K extends AssetEventName>(
  event: K,
  payload: EngineEventMap[K],
) => void;

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

/**
 * The map names a material document may use for each slot: the engine's own
 * camelCase slot names, plus the kebab-case channel names the asset-generation
 * tools write into `material.json` (`base-color` and friends), so a produced
 * folder loads without renaming and a hand-written document reads naturally.
 */
const MATERIAL_SLOTS: Readonly<Record<string, MaterialMapSlot>> = {
  baseColor: "baseColor",
  "base-color": "baseColor",
  normal: "normal",
  roughness: "roughness",
  metallic: "metallic",
  ao: "ao",
  emissive: "emissive",
  height: "height",
};

/**
 * Resolves and loads a game's assets under a fixed root, announcing every attempt.
 *
 * Every collaborator is injected: the fetcher so the loader can be driven without
 * a server (and so a failure a real network cannot be asked for on demand can be
 * produced at will), the root so the engine rather than this class owns the
 * convention, and the emitter so this module stays a leaf. Decoding is the
 * loader's own — {@link decodePng}, {@link decodeWav}, and the glTF-binary
 * parser below — so nothing here needs a platform decoder and every loader
 * resolves identically in a browser and in Node.
 */
export class AssetLoader {
  private readonly root: string;
  private readonly fetcher: (url: string) => Promise<Response>;
  private readonly emit: AssetEventEmitter;

  constructor(options: AssetLoaderOptions = {}) {
    const root = options.root ?? DEFAULT_ROOT;
    // Normalising the trailing slash here means the root can be written either
    // way at the call site and `resolve` stays a plain concatenation. An empty
    // root is left empty: it means "beside the page", and appending a slash would
    // silently turn every path absolute.
    this.root = root === "" || root.endsWith("/") ? root : `${root}/`;
    this.fetcher = options.fetch ?? defaultFetch;
    this.emit = options.emit ?? (() => {});
  }

  /**
   * Turns a game-supplied path into the URL it loads from, throwing if the path
   * would escape the asset root.
   *
   * Pure: it neither fetches nor announces anything, so a game that hands a URL
   * to an element rather than fetching it does not invent an event for a load
   * this loader never performed. The events stay a record of what the engine
   * itself did.
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
   * This is the loader for a kind of file the engine has no opinion about. The
   * root rule and the events apply exactly as they do to the typed loaders, so a
   * build's level data is as visible as its textures.
   */
  load(path: string): Promise<Blob> {
    return this.attempt(path, (blob) => Promise.resolve(blob));
  }

  /**
   * Loads a PNG and decodes it to a {@link TextureHandle} ready to use as a
   * texture. The decoded pixels are reachable through {@link decodedTexture};
   * the handle itself carries only the documented plain fields.
   */
  loadTexture(path: string): Promise<TextureHandle> {
    return this.attempt(path, async (blob) => {
      const decoded = decodePng(new Uint8Array(await blob.arrayBuffer()));
      return this.registerTexture(path, decoded);
    });
  }

  /**
   * Loads a PCM WAV and decodes it to an `AudioBuffer` ready to play.
   *
   * The value is a {@link PcmAudioBuffer}, the `AudioBuffer`-shaped result the
   * docs promise headless: the same promise resolves whether or not an audio
   * context exists, and where a real one does, the audio bus feeds these same
   * samples into a native buffer. Typed as `AudioBuffer` because that is the
   * documented signature and the shape every consumer reads.
   */
  loadAudio(path: string): Promise<AudioBuffer> {
    return this.attempt(path, async (blob) => {
      const decoded = decodeWav(new Uint8Array(await blob.arrayBuffer()));
      return new PcmAudioBuffer(
        decoded.sampleRate,
        decoded.channels,
      ) as unknown as AudioBuffer;
    });
  }

  /**
   * Loads a glTF binary and decodes it to a {@link MeshHandle} ready to draw.
   * The parsed chunks are reachable through {@link decodedMesh}.
   */
  loadMesh(path: string): Promise<MeshHandle> {
    return this.attempt(path, async (blob) => {
      const decoded = parseGlb(path, new Uint8Array(await blob.arrayBuffer()));
      const handle: MeshHandle = Object.freeze({
        path,
        bounds: meshBounds(decoded),
        nodes: Object.freeze(namesOf(decoded.json.nodes)),
        clips: Object.freeze(namesOf(decoded.json.animations)),
      });
      MESH_DATA.set(handle, decoded);
      return handle;
    });
  }

  /**
   * Loads a material document, fetches and decodes every map it names, and
   * resolves to a {@link MaterialHandle}.
   *
   * One call and one event: the map fetches happen inside it and announce
   * nothing of their own, so a subscriber counts materials rather than
   * textures. A map that fails fails the whole load — the promise rejects with
   * the map's own error and the single `asset:failed` names the map — because
   * the decision whether a material is usable belongs to the load, not to a
   * mesh later drawn with half its maps. Map paths are relative to the
   * document's own directory under the root, so a material and its textures
   * travel as one folder, and a map path that would escape the root is refused
   * by the same rules as any other path.
   */
  async loadMaterial(path: string): Promise<MaterialHandle> {
    let url: string;
    try {
      url = this.resolve(path);
    } catch (error) {
      this.emit("asset:failed", { path, url: "", reason: reasonOf(error) });
      throw error;
    }

    // Whether the map loop already announced the failure with its richer,
    // map-naming reason. A local flag rather than a mark on the error itself,
    // because a rejection can be any value — a string, a number — and the
    // one-event-per-call rule must hold for those too.
    let announced = false;
    let handle: MaterialHandle;
    try {
      const response = await this.fetcher(url);
      if (!response.ok) {
        throw new Error(
          `asset "${path}" failed to load from "${url}": HTTP ${response.status}`,
        );
      }
      const entries = parseMaterialDocument(path, await response.text());

      // The document's own directory, which every map path is relative to.
      const lastSlash = path.lastIndexOf("/");
      const directory = lastSlash === -1 ? "" : path.slice(0, lastSlash + 1);

      const maps: Partial<Record<MaterialMapSlot, TextureHandle>> = {};
      for (const entry of entries) {
        try {
          const mapPath = `${directory}${entry.relativePath}`;
          const mapUrl = this.resolve(mapPath);
          const mapResponse = await this.fetcher(mapUrl);
          if (!mapResponse.ok) {
            throw new Error(
              `asset "${mapPath}" failed to load from "${mapUrl}": HTTP ${mapResponse.status}`,
            );
          }
          const decoded = decodePng(
            new Uint8Array(await mapResponse.arrayBuffer()),
          );
          maps[entry.slot] = this.registerTexture(mapPath, decoded);
        } catch (mapError) {
          // The single failure event carries the *document's* path and URL —
          // that is the load the game made — with the reason naming the map,
          // and the rejection is the map's own error, unchanged.
          this.emit("asset:failed", {
            path,
            url,
            reason: `map "${entry.slot}" (${entry.relativePath}): ${reasonOf(mapError)}`,
          });
          announced = true;
          throw mapError;
        }
      }
      handle = Object.freeze({ path, maps: Object.freeze(maps) });
    } catch (error) {
      // A map failure announced itself above with its richer reason; every
      // other failure of the one call is announced here, once.
      if (!announced) {
        this.emit("asset:failed", { path, url, reason: reasonOf(error) });
      }
      throw error;
    }

    this.emit("asset:loaded", { path, url });
    return handle;
  }

  /**
   * The shared body of the single-fetch loaders: resolve, fetch, decode,
   * announce once.
   *
   * Every loader routes through here so a path refused by one is refused
   * identically by all of them, and so the "exactly one event per call" rule is a
   * property of one function rather than a convention each of them keeps.
   *
   * The success event is emitted *after* the try block on purpose. Emitting it
   * inside would let a subscriber that throws turn a load that succeeded into one
   * that also reported a failure, which is the one shape an observer must never
   * have to reason about.
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

  /** Builds and registers a texture handle over decoded pixels. */
  private registerTexture(path: string, decoded: DecodedPng): TextureHandle {
    const handle: TextureHandle = Object.freeze({
      path,
      width: decoded.width,
      height: decoded.height,
    });
    TEXTURE_PIXELS.set(handle, decoded);
    return handle;
  }
}

/* -------------------------------------------------------------------------- */
/* The material document                                                      */
/* -------------------------------------------------------------------------- */

/** One map the document names, resolved to its slot. */
interface MaterialEntry {
  slot: MaterialMapSlot;
  relativePath: string;
}

/**
 * Parses a `material.json` body to its named maps.
 *
 * Two shapes are accepted, refused by name otherwise: the array the
 * asset-generation `pbr` tool writes — `maps: [{ name, path, ... }]` with
 * kebab-case channel names — and the plain-object form a hand-written document
 * naturally takes — `maps: { baseColor: "basecolor.png", ... }`. A document
 * with no `maps` field is missing its required fields, and a map name outside
 * the seven slots is refused rather than silently dropped, because a material
 * drawn without a map its author declared is the failure hardest to see.
 */
function parseMaterialDocument(path: string, text: string): MaterialEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `asset "${path}" could not be parsed as a material document: ${reasonOf(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(
      `asset "${path}" is not a material document: expected a JSON object, got ${typeof parsed}`,
    );
  }
  const maps = (parsed as { maps?: unknown }).maps;
  if (maps === undefined || maps === null) {
    throw new Error(
      `asset "${path}" is missing its required fields: a material document names its maps under "maps"`,
    );
  }

  const entries: MaterialEntry[] = [];
  const add = (name: string, relativePath: unknown): void => {
    const slot = MATERIAL_SLOTS[name];
    if (slot === undefined) {
      const slots = Object.keys(MATERIAL_SLOTS)
        .map((key) => `"${key}"`)
        .join(", ");
      throw new Error(
        `asset "${path}" names an unknown map "${name}" — the slots are ${slots}`,
      );
    }
    if (typeof relativePath !== "string" || relativePath === "") {
      throw new Error(
        `asset "${path}" names map "${name}" with no path: each map needs a path relative to the document's directory`,
      );
    }
    entries.push({ slot, relativePath });
  };

  if (Array.isArray(maps)) {
    for (const [index, entry] of maps.entries()) {
      if (entry === null || typeof entry !== "object") {
        throw new Error(
          `asset "${path}" is missing its required fields: maps[${index}] is not an object`,
        );
      }
      const { name, path: mapPath } = entry as {
        name?: unknown;
        path?: unknown;
      };
      if (typeof name !== "string") {
        throw new Error(
          `asset "${path}" is missing its required fields: maps[${index}] has no "name"`,
        );
      }
      add(name, mapPath);
    }
  } else if (typeof maps === "object") {
    for (const [name, mapPath] of Object.entries(maps)) {
      add(name, mapPath);
    }
  } else {
    throw new Error(
      `asset "${path}" is missing its required fields: "maps" must be an array or an object, got ${typeof maps}`,
    );
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* The glTF binary                                                            */
/* -------------------------------------------------------------------------- */

/** `"glTF"`, `JSON`, and `BIN\0` as the little-endian words the header uses. */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** `FLOAT` and `VEC3`, the only accessor encoding the bounds walk reads. */
const COMPONENT_FLOAT = 5126;

/**
 * Parses a glTF binary container to its JSON and binary chunks.
 *
 * Refusals name the path and the defect, because "not a glTF binary" is the
 * decode error the outcome table promises and the first thing an author needs
 * is which file and which way it is wrong.
 */
export function parseGlb(path: string, bytes: Uint8Array): DecodedGlb {
  if (bytes.length < 12) {
    throw new Error(
      `asset "${path}" is not a glTF binary: ${bytes.length} bytes is shorter than the 12-byte header`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new Error(
      `asset "${path}" is not a glTF binary: the magic is 0x${magic.toString(16)}, not "glTF"`,
    );
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new Error(
      `asset "${path}" is not a glTF binary this engine reads: container version ${version}, expected 2`,
    );
  }

  let json: GlbJson | null = null;
  // Annotated: the chunks are subarrays over the fetched bytes, whose buffer
  // is only `ArrayBufferLike`, and the inferred `Uint8Array<ArrayBuffer>` of a
  // fresh empty array would refuse them.
  let bin: Uint8Array = new Uint8Array(0);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const chunkLength = view.getUint32(at, true);
    const chunkType = view.getUint32(at + 4, true);
    const start = at + 8;
    if (start + chunkLength > bytes.length) {
      throw new Error(
        `asset "${path}" is not a glTF binary: a chunk of ${chunkLength} bytes at offset ${at} runs past the file`,
      );
    }
    const chunk = bytes.subarray(start, start + chunkLength);
    if (chunkType === CHUNK_JSON && json === null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder().decode(chunk));
      } catch (error) {
        throw new Error(
          `asset "${path}" is not a glTF binary: its JSON chunk does not parse (${reasonOf(error)})`,
        );
      }
      if (parsed === null || typeof parsed !== "object") {
        throw new Error(
          `asset "${path}" is not a glTF binary: its JSON chunk is not an object`,
        );
      }
      json = parsed as GlbJson;
    } else if (chunkType === CHUNK_BIN && bin.length === 0) {
      bin = chunk;
    }
    // Chunks are word-aligned; a conforming writer pads them, and walking the
    // declared length either way keeps a padded and an unpadded file readable.
    at = start + chunkLength + ((4 - (chunkLength % 4)) % 4);
  }
  if (json === null) {
    throw new Error(
      `asset "${path}" is not a glTF binary: it carries no JSON chunk`,
    );
  }
  return { json, bin };
}

/** The `name` fields of a glTF array, in file order, unnamed entries skipped. */
function namesOf(
  list: readonly { readonly name?: string }[] | undefined,
): string[] {
  const names: string[] = [];
  for (const entry of list ?? []) {
    if (typeof entry.name === "string") names.push(entry.name);
  }
  return names;
}

/**
 * The file's axis-aligned bounds in its own local units.
 *
 * The walk follows the default scene's node tree, composing each node's TRS or
 * matrix, and unions each referenced mesh primitive's POSITION range — read
 * from the accessor's declared `min`/`max`, or computed from the data when a
 * writer left them out — transformed through the node chain as its eight box
 * corners. A file whose scene references no mesh falls back to the raw union
 * of every POSITION range, and a file with no positions at all bounds to a
 * zero box at the origin: an empty answer, not a refusal, because a mesh with
 * nothing to measure still draws as nothing rather than failing its load.
 */
function meshBounds(decoded: DecodedGlb): Box3 {
  const { json, bin } = decoded;
  const bounds = emptyBounds();

  const sceneNodes =
    json.scenes?.[json.scene ?? 0]?.nodes ??
    (json.nodes ?? []).map((_, index) => index);

  const visited = new Set<number>();
  const walk = (index: number, apply: (p: Vec3) => Vec3): void => {
    // glTF requires a tree, but a malformed file must not hang the loader.
    if (visited.has(index)) return;
    visited.add(index);
    const node = json.nodes?.[index];
    if (node === undefined) return;
    const applyHere = (p: Vec3): Vec3 => apply(applyNode(node, p));
    if (typeof node.mesh === "number") {
      const range = meshPositionRange(json, bin, node.mesh);
      if (range !== null) unionCorners(bounds, range, applyHere);
    }
    for (const child of node.children ?? [])
      walk(
        child,
        apply === identityApply && isIdentityNode(node) ? apply : applyHere,
      );
    visited.delete(index);
  };

  for (const index of sceneNodes) walk(index, identityApply);

  if (!isEmpty(bounds)) return freezeBounds(bounds);

  // No scene node referenced a mesh: the raw union of every POSITION range.
  for (const [meshIndex] of (json.meshes ?? []).entries()) {
    const range = meshPositionRange(json, bin, meshIndex);
    if (range !== null) unionCorners(bounds, range, identityApply);
  }
  if (!isEmpty(bounds)) return freezeBounds(bounds);
  return freezeBounds({
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  });
}

/** The identity point application, shared so the walk can compare against it. */
function identityApply(p: Vec3): Vec3 {
  return p;
}

/** Whether a node carries no transform at all. */
function isIdentityNode(node: GlbNode): boolean {
  return (
    node.matrix === undefined &&
    node.translation === undefined &&
    node.rotation === undefined &&
    node.scale === undefined
  );
}

/** Applies one node's own transform — TRS, or a column-major matrix — to a point. */
function applyNode(node: GlbNode, p: Vec3): Vec3 {
  const m = node.matrix;
  if (m !== undefined && m.length === 16) {
    return {
      x:
        (m[0] ?? 0) * p.x +
        (m[4] ?? 0) * p.y +
        (m[8] ?? 0) * p.z +
        (m[12] ?? 0),
      y:
        (m[1] ?? 0) * p.x +
        (m[5] ?? 0) * p.y +
        (m[9] ?? 0) * p.z +
        (m[13] ?? 0),
      z:
        (m[2] ?? 0) * p.x +
        (m[6] ?? 0) * p.y +
        (m[10] ?? 0) * p.z +
        (m[14] ?? 0),
    };
  }
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const transform: Transform = {
    position: { x: t[0] ?? 0, y: t[1] ?? 0, z: t[2] ?? 0 },
    rotation: {
      x: r[0] ?? 0,
      y: r[1] ?? 0,
      z: r[2] ?? 0,
      w: r[3] ?? 1,
    } as Quat,
    scale: { x: s[0] ?? 1, y: s[1] ?? 1, z: s[2] ?? 1 },
  };
  return transformPoint(transform, p);
}

/** A mesh's POSITION min/max over all its primitives, or `null` for none. */
function meshPositionRange(
  json: GlbJson,
  bin: Uint8Array,
  meshIndex: number,
): Box3 | null {
  const mesh = json.meshes?.[meshIndex];
  if (mesh === undefined) return null;
  const range = emptyBounds();
  for (const primitive of mesh.primitives ?? []) {
    const accessorIndex = primitive.attributes?.["POSITION"];
    if (accessorIndex === undefined) continue;
    const accessor = json.accessors?.[accessorIndex];
    if (accessor === undefined) continue;
    const declared = declaredRange(accessor);
    const found = declared ?? computedRange(json, bin, accessor);
    if (found === null) continue;
    unionPoint(range, found.min);
    unionPoint(range, found.max);
  }
  return isEmpty(range) ? null : range;
}

/** The accessor's declared `min`/`max` as a box, or `null` when absent. */
function declaredRange(accessor: GlbAccessor): Box3 | null {
  const { min, max } = accessor;
  if (min === undefined || max === undefined) return null;
  if (min.length < 3 || max.length < 3) return null;
  return {
    min: { x: min[0] ?? 0, y: min[1] ?? 0, z: min[2] ?? 0 },
    max: { x: max[0] ?? 0, y: max[1] ?? 0, z: max[2] ?? 0 },
  };
}

/**
 * The accessor's range computed from its float VEC3 data, for a writer that
 * left `min`/`max` out. Any other encoding contributes nothing rather than
 * failing the load: the bounds are a convenience of the handle, and refusing a
 * whole mesh over an exotic position encoding would cost far more than an
 * empty box does.
 */
function computedRange(
  json: GlbJson,
  bin: Uint8Array,
  accessor: GlbAccessor,
): Box3 | null {
  if (accessor.componentType !== COMPONENT_FLOAT || accessor.type !== "VEC3") {
    return null;
  }
  const viewIndex = accessor.bufferView;
  if (viewIndex === undefined) return null;
  const bufferView = json.bufferViews?.[viewIndex];
  if (bufferView === undefined || (bufferView.buffer ?? 0) !== 0) return null;

  const stride = bufferView.byteStride ?? 12;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const count = accessor.count ?? 0;
  if (count === 0 || start + (count - 1) * stride + 12 > bin.length) {
    return null;
  }

  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const range = emptyBounds();
  for (let i = 0; i < count; i += 1) {
    const at = start + i * stride;
    unionPoint(range, {
      x: view.getFloat32(at, true),
      y: view.getFloat32(at + 4, true),
      z: view.getFloat32(at + 8, true),
    });
  }
  return range;
}

/** A box that unions from nothing: min at +∞, max at −∞. */
function emptyBounds(): Box3 {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
}

/** Whether nothing has been unioned in yet. */
function isEmpty(bounds: Box3): boolean {
  return bounds.min.x > bounds.max.x;
}

/** Grows `bounds` to hold `p`. */
function unionPoint(bounds: Box3, p: Vec3): void {
  bounds.min.x = Math.min(bounds.min.x, p.x);
  bounds.min.y = Math.min(bounds.min.y, p.y);
  bounds.min.z = Math.min(bounds.min.z, p.z);
  bounds.max.x = Math.max(bounds.max.x, p.x);
  bounds.max.y = Math.max(bounds.max.y, p.y);
  bounds.max.z = Math.max(bounds.max.z, p.z);
}

/**
 * Grows `bounds` by a box's eight corners under a point transform. The corners
 * rather than the two extremes, because a rotation moves which corner is
 * extreme and transforming only min and max would under-report every tilted
 * mesh.
 */
function unionCorners(bounds: Box3, box: Box3, apply: (p: Vec3) => Vec3): void {
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        unionPoint(bounds, apply({ x, y, z }));
      }
    }
  }
}

/** Deep-freezes a box so a handle's bounds cannot be nudged after the load. */
function freezeBounds(bounds: Box3): Box3 {
  Object.freeze(bounds.min);
  Object.freeze(bounds.max);
  return Object.freeze(bounds);
}
