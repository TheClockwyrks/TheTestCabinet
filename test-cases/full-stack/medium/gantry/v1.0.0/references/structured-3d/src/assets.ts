// The produced models `specs/assets.md` lists, loaded once and held for the
// life of the game.
//
// The engine's asset loader resolves every path under `ASSET_ROOT` and decodes
// the glTF the `voxel` tool wrote, so a committed `.glb` comes back as the node
// tree, meshes, and per-vertex colors the file carries. A `Model` is a template
// a model component clones, so one load backs every copy of that part on
// screen. Nothing else in this build fetches or decodes an asset.

import type { InitApi, Model } from "@clockwyrks/structured-3d";

/** The eight produced models, under the names `specs/assets.md` gives them. */
export const MODEL_NAMES = [
  "ring",
  "trolley",
  "hook",
  "counterweight",
  "mount",
  "crate",
  "container",
  "drum",
] as const;

export type ModelName = (typeof MODEL_NAMES)[number];

/** Every produced model, by name. */
export type Models = Readonly<Record<ModelName, Model>>;

let loaded: Models | null = null;

/** Hold what the instance's `initialize` loaded. */
export function setModels(models: Models): void {
  loaded = models;
}

/**
 * The produced models. The instance's `initialize` is awaited before the start
 * level opens, so an actor constructed for that level reads these as plain
 * values; reaching them before the load has resolved is a mistake and throws.
 */
export function models(): Models {
  if (loaded === null) throw new Error("Gantry: the models are not loaded");
  return loaded;
}

/** Whether the models are in place, which a seam may want to check. */
export const modelsLoaded = (): boolean => loaded !== null;

/** The path a produced model is committed at, relative to the asset root. */
export const modelPath = (name: ModelName): string => `models/${name}.glb`;

/** Load all eight models through the engine's loader, in one pass. */
export async function loadModels(assets: InitApi["assets"]): Promise<Models> {
  const decoded = await Promise.all(
    MODEL_NAMES.map((name) => assets.loadModel(modelPath(name))),
  );
  const models = {} as Record<ModelName, Model>;
  MODEL_NAMES.forEach((name, i) => {
    models[name] = decoded[i];
  });
  return models;
}
