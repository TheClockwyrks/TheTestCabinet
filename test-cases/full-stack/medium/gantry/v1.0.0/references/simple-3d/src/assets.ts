// The produced files: the eight models and the twelve sounds
// `specs/assets.md` lists, committed under `assets/` and bundled into the
// build.
//
// The engine's asset loader resolves every path under one root, `ASSET_ROOT`,
// relative to the page, and it is also the decoder: `loadModel` hands a
// committed `.glb` back as a template whose meshes carry the file's own
// per-vertex colors, and `audio.load` fetches and decodes a `.wav` and binds it
// to a cue name. Nothing here fetches a URL of its own and nothing decodes
// glTF itself.
//
// A model is a three object, so the state never carries one: the decoded
// templates live here, beside the retained scene, and the yard clones one for
// each subject it draws (`specs/assets.md`).

import { cloneModel } from "@test-cabinet/simple-3d";
import type { InitApi, Model } from "@test-cabinet/simple-3d";
import * as THREE from "three";
import { CUES, VOXELS_PER_UNIT, type CueName } from "./constants";
import type { GantryState } from "./game";

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
 * The scale every model is drawn at: they are sculpted at `VOXELS_PER_UNIT`
 * voxels to the world unit, so a decoded mesh is in voxels and one world unit
 * is `VOXELS_PER_UNIT` of them.
 */
export const MODEL_SCALE = 1 / VOXELS_PER_UNIT;

/**
 * The music bed's cue name. It is not one of `CUES` — those are the one-shots
 * and the `motor` loop `specs/ui.md` tabulates — but it reaches the bus the
 * same way, as a file-backed cue the title and select screens loop.
 */
export const MUSIC_CUE = "music";

/** The path a model is committed at, under the asset root. */
export const modelPath = (name: ModelName): string => `models/${name}.glb`;

/** The path a cue's sound is committed at, under the asset root. */
export const cuePath = (cue: string): string => `audio/${cue}.wav`;

/** The decoded templates, keyed by name. A template is never placed itself. */
const templates = new Map<ModelName, Model>();

/**
 * One decoded model. Throws where the model was not loaded, which can only be a
 * mistake in the build rather than a missing file: a file that failed to load
 * rejects `initialize` instead.
 */
export function modelTemplate(name: ModelName): Model {
  const model = templates.get(name);
  if (model === undefined) {
    throw new Error(`gantry: the ${name} model was not loaded`);
  }
  return model;
}

/**
 * A copy of one model, in world units and ready to place in the scene: the
 * clone carries the template's geometries and materials, scaled once here so
 * nothing placing it needs a scale of its own.
 */
export function placeModel(name: ModelName): THREE.Group {
  const group = cloneModel(modelTemplate(name));
  group.scale.setScalar(MODEL_SCALE);
  return group;
}

/**
 * Load every produced file. Resolves once all of them are in hand; a file that
 * is missing or unreadable rejects, and with it `engine.initialize`, since the
 * build ships them all.
 */
export async function loadProducedAssets(
  api: InitApi<GantryState>,
): Promise<void> {
  const models = await Promise.all(
    MODEL_NAMES.map(async (name) => {
      const model = await api.assets.loadModel(modelPath(name));
      return [name, model] as const;
    }),
  );
  for (const [name, model] of models) templates.set(name, model);

  const sounds: readonly string[] = [...CUES, MUSIC_CUE];
  await Promise.all(
    sounds.map((cue: string) => api.audio.load(cue, cuePath(cue))),
  );
}

/** The cue names the build binds a file to, the music bed included. */
export const SOUND_NAMES: readonly string[] = [
  ...(CUES as readonly CueName[]),
  MUSIC_CUE,
];
