// The produced files: the eight models and the twelve sounds `specs/assets.md`
// lists, committed under `assets/` and bundled into the build.
//
// Every asset is referenced page-relative, never by a root-absolute URL, so the
// built site runs from a sub-path as well as from a root: each file is resolved
// with `new URL("../assets/...", import.meta.url)`, which the bundler rewrites
// to the emitted file's own URL, and that URL is what is fetched. Nothing is
// fetched from outside the build's own `dist/`, and no asset tool runs at build
// time — the committed files are the assets.
//
// A `.glb` is decoded here, with `parseGlb` from `@test-cabinet/voxel-runtime`,
// which returns the mesh as plain typed arrays with per-vertex colors; the
// `three` binding's `buildPartGeometry` wraps one into the `BufferGeometry` the
// scene draws. A `.wav` is handed on as bytes for the runtime's audio bus to
// decode, since the bus owns the `AudioContext`.

import { parseGlb } from "@test-cabinet/voxel-runtime";
import type { PartMesh } from "@test-cabinet/voxel-runtime";
import { buildPartGeometry } from "@test-cabinet/voxel-runtime/three";
import type { BufferGeometry } from "three";
import { CUES, VOXELS_PER_UNIT } from "./constants";
import type { CueName } from "./constants";

/** The eight produced models (`specs/assets.md`). */
export type ModelName =
  | "ring"
  | "trolley"
  | "hook"
  | "counterweight"
  | "mount"
  | "crate"
  | "container"
  | "drum";

export const MODEL_NAMES: readonly ModelName[] = [
  "ring",
  "trolley",
  "hook",
  "counterweight",
  "mount",
  "crate",
  "container",
  "drum",
];

/**
 * The scale every model is drawn at: the models are sculpted at
 * `VOXELS_PER_UNIT` voxels to the world unit, so a decoded mesh is in voxels
 * and one world unit is `VOXELS_PER_UNIT` of them.
 */
export const MODEL_SCALE = 1 / VOXELS_PER_UNIT;

/**
 * Where each model is, page-relative. Each entry is written as its own literal
 * `new URL(..., import.meta.url)` so the bundler can see the reference, emit
 * the file into `dist/`, and rewrite the URL to the emitted one; a path built
 * from a variable would be invisible to it.
 */
export const MODEL_URLS: Readonly<Record<ModelName, string>> = {
  ring: new URL("../assets/models/ring.glb", import.meta.url).href,
  trolley: new URL("../assets/models/trolley.glb", import.meta.url).href,
  hook: new URL("../assets/models/hook.glb", import.meta.url).href,
  counterweight: new URL("../assets/models/counterweight.glb", import.meta.url)
    .href,
  mount: new URL("../assets/models/mount.glb", import.meta.url).href,
  crate: new URL("../assets/models/crate.glb", import.meta.url).href,
  container: new URL("../assets/models/container.glb", import.meta.url).href,
  drum: new URL("../assets/models/drum.glb", import.meta.url).href,
};

/** Where each cue's sound is, page-relative, one per cue in `specs/ui.md`. */
export const CUE_URLS: Readonly<Record<CueName, string>> = {
  place: new URL("../assets/audio/place.wav", import.meta.url).href,
  delete: new URL("../assets/audio/delete.wav", import.meta.url).href,
  "run-start": new URL("../assets/audio/run-start.wav", import.meta.url).href,
  attach: new URL("../assets/audio/attach.wav", import.meta.url).href,
  placed: new URL("../assets/audio/placed.wav", import.meta.url).href,
  creak: new URL("../assets/audio/creak.wav", import.meta.url).href,
  break: new URL("../assets/audio/break.wav", import.meta.url).href,
  collapse: new URL("../assets/audio/collapse.wav", import.meta.url).href,
  complete: new URL("../assets/audio/complete.wav", import.meta.url).href,
  fail: new URL("../assets/audio/fail.wav", import.meta.url).href,
  motor: new URL("../assets/audio/motor.wav", import.meta.url).href,
};

/** Where the music bed is, page-relative. */
export const MUSIC_URL: string = new URL(
  "../assets/audio/music.wav",
  import.meta.url,
).href;

/** Everything the build ships as a produced file, loaded and ready to use. */
export interface GantryAssets {
  /**
   * Each model decoded to its mesh. The game draws every one at a scale of
   * `1 / VOXELS_PER_UNIT`.
   */
  models: Record<ModelName, PartMesh>;
  /** Each cue's encoded WAV bytes, for the audio bus to decode. */
  cues: Record<CueName, ArrayBuffer>;
  /** The music bed's encoded WAV bytes. */
  music: ArrayBuffer;
}

/**
 * How the bytes of one produced file are got. The page fetches them; a test
 * hands the loader the committed files instead, which is the only reason this
 * is a parameter at all.
 */
export type ByteLoader = (url: string) => Promise<ArrayBuffer>;

/** `RIFF`, and `WAVE`, as the little-endian words they read as in a header. */
const RIFF_MAGIC = 0x46464952;
const WAVE_MAGIC = 0x45564157;

/** Fetch one produced file's bytes from the URL the bundler emitted. */
async function fetchBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url).catch((cause: unknown) => {
    throw new Error(`gantry: could not load ${url} (${String(cause)})`);
  });
  if (!response.ok) {
    throw new Error(`gantry: could not load ${url} (${response.status})`);
  }
  return await response.arrayBuffer();
}

/**
 * Decode one model, and refuse a file that is not the mesh the game draws: an
 * empty or ragged one would draw as nothing rather than fail, and the build
 * ships all eight.
 */
export function decodeModel(name: ModelName, bytes: ArrayBuffer): PartMesh {
  let mesh: PartMesh;
  try {
    mesh = parseGlb(bytes);
  } catch (cause) {
    throw new Error(
      `gantry: ${name}.glb is not a readable glb (${String(cause)})`,
    );
  }
  const vertices = mesh.positions.length;
  const ok =
    vertices > 0 &&
    vertices % 3 === 0 &&
    mesh.normals.length === vertices &&
    mesh.colors.length === vertices &&
    mesh.indices.length > 0 &&
    mesh.indices.length % 3 === 0;
  if (!ok) {
    throw new Error(`gantry: ${name}.glb carries no usable mesh`);
  }
  return mesh;
}

/**
 * Check one sound is the PCM WAV the audio bus decodes. The bus does the
 * decoding; this only turns a missing or wrong file into a plain error at load
 * rather than a silent cue much later.
 */
export function checkWav(name: string, bytes: ArrayBuffer): ArrayBuffer {
  const header = new DataView(bytes);
  const riff =
    bytes.byteLength >= 12 &&
    header.getUint32(0, true) === RIFF_MAGIC &&
    header.getUint32(8, true) === WAVE_MAGIC;
  if (!riff) {
    throw new Error(`gantry: ${name}.wav is not a WAV file`);
  }
  return bytes;
}

/** Load every file of one named set at once, keeping the names as the keys. */
async function loadAll<K extends string>(
  names: readonly K[],
  urls: Readonly<Record<K, string>>,
  load: ByteLoader,
): Promise<Record<K, ArrayBuffer>> {
  const bytes = await Promise.all(names.map((name) => load(urls[name])));
  const loaded = {} as Record<K, ArrayBuffer>;
  names.forEach((name, index) => {
    loaded[name] = bytes[index];
  });
  return loaded;
}

/**
 * Fetch and decode every produced file. Resolves once all of them are in hand;
 * rejects if one is missing or unreadable, since the build ships them all.
 */
export async function loadAssets(
  load: ByteLoader = fetchBytes,
): Promise<GantryAssets> {
  const [modelBytes, cueBytes, musicBytes] = await Promise.all([
    loadAll(MODEL_NAMES, MODEL_URLS, load),
    loadAll(CUES, CUE_URLS, load),
    load(MUSIC_URL),
  ]);

  const models = {} as Record<ModelName, PartMesh>;
  for (const name of MODEL_NAMES) {
    models[name] = decodeModel(name, modelBytes[name]);
  }
  const cues = {} as Record<CueName, ArrayBuffer>;
  for (const cue of CUES) {
    cues[cue] = checkWav(cue, cueBytes[cue]);
  }
  return { models, cues, music: checkWav("music", musicBytes) };
}

/**
 * Wrap each decoded model into the `BufferGeometry` the scene draws, through
 * the runtime's `three` binding, with per-vertex colors (draw it with a
 * material that has `vertexColors` on).
 *
 * The geometry comes back **in world units**: the mesh's voxel coordinates are
 * scaled by `MODEL_SCALE` here, once, so a mesh placed in the scene needs no
 * scale of its own. It is not recentered — the model's own origin is kept, so
 * where each part sits is the scene's to decide.
 */
export function buildModelGeometries(
  models: Readonly<Record<ModelName, PartMesh>>,
): Record<ModelName, BufferGeometry> {
  const geometries = {} as Record<ModelName, BufferGeometry>;
  for (const name of MODEL_NAMES) {
    const geometry = buildPartGeometry(models[name]);
    geometry.scale(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE);
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    geometries[name] = geometry;
  }
  return geometries;
}
