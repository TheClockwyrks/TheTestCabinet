// The produced files: that the build asks for the paths `specs/assets.md` fixes,
// and that every one of them is committed under the asset root.

import { describe, expect, it } from "vitest";
import { ASSET_ROOT, CUES, VOXELS_PER_UNIT } from "./constants";
import type { InitApi, Model } from "@clockwyrks/simple-3d";
import type { GantryState } from "./game";
import {
  cuePath,
  loadProducedAssets,
  MODEL_NAMES,
  MODEL_SCALE,
  MUSIC_CUE,
  modelPath,
  modelTemplate,
  SOUND_NAMES,
  type ModelName,
} from "./assets";

/**
 * The committed files, read through a specifier the compiler does not resolve
 * so the test runs in Node without the bundler taking part.
 */
async function committed(relative: string): Promise<number> {
  const specifier = "node:fs/promises";
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    stat(path: URL): Promise<{ size: number }>;
  };
  const stat = await fs.stat(
    new URL(`../${ASSET_ROOT}${relative}`, import.meta.url),
  );
  return stat.size;
}

describe("the paths", () => {
  it("name each model and each sound under the asset root", () => {
    expect(modelPath("ring")).toBe("models/ring.glb");
    expect(cuePath("place")).toBe("audio/place.wav");
    expect(cuePath(MUSIC_CUE)).toBe("audio/music.wav");
  });

  it("cover the eight models and the twelve sounds", () => {
    expect(MODEL_NAMES).toHaveLength(8);
    expect(SOUND_NAMES).toHaveLength(CUES.length + 1);
    expect(SOUND_NAMES).toContain(MUSIC_CUE);
  });

  it("draws every model at one voxel-unit's scale", () => {
    expect(MODEL_SCALE).toBe(1 / VOXELS_PER_UNIT);
  });
});

describe("the committed files", () => {
  it("carry every model the build loads", async () => {
    for (const name of MODEL_NAMES) {
      expect(await committed(modelPath(name))).toBeGreaterThan(0);
    }
  });

  it("carry every sound the build binds, and the music bed's midi", async () => {
    for (const cue of SOUND_NAMES) {
      expect(await committed(cuePath(cue))).toBeGreaterThan(0);
    }
    expect(await committed("audio/music.mid")).toBeGreaterThan(0);
  });
});

describe("loading", () => {
  it("asks the engine's loader for every path, and binds every cue", async () => {
    const models: string[] = [];
    const sounds: [string, string][] = [];
    const api = {
      assets: {
        loadModel: (path: string) => {
          models.push(path);
          return Promise.resolve({
            scene: {},
            animations: [],
            nodes: [],
          } as unknown as Model);
        },
      },
      audio: {
        load: (cue: string, path: string) => {
          sounds.push([cue, path]);
          return Promise.resolve();
        },
      },
    } as unknown as InitApi<GantryState>;

    await loadProducedAssets(api);
    expect(models.sort()).toEqual(MODEL_NAMES.map(modelPath).sort());
    expect(sounds.map(([cue]) => cue).sort()).toEqual([...SOUND_NAMES].sort());
    for (const [cue, path] of sounds) expect(path).toBe(cuePath(cue));
    // Every template is in hand once loading resolves.
    for (const name of MODEL_NAMES) expect(modelTemplate(name)).toBeDefined();
  });
});

describe("a model that was never loaded", () => {
  it("fails where it is asked for rather than drawing nothing", () => {
    expect(() => modelTemplate("nothing" as unknown as ModelName)).toThrow(
      /was not loaded/,
    );
  });
});
