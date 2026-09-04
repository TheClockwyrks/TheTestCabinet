import { describe, expect, it } from "vitest";
import { existsSync, statSync } from "node:fs";

import {
  aperturePath,
  installAssets,
  loadAssets,
  NO_SPRITES,
  orrerySprites,
  particleSystemOf,
  spritePaths,
} from "./assets";
import {
  APERTURE_FRAMES,
  APERTURE_SHEETS,
  CUE_PATHS,
  MOTE_SPRITE_PATHS,
  PARTICLE_PATHS,
} from "./constants";
import { CUE_NAMES, PARTICLE_NAMES } from "./figures";

/** An asset loader that answers every path the way a headless run does. */
function failingApi(): Parameters<typeof loadAssets>[0] {
  return {
    assets: {
      loadImage: () => Promise.reject(new Error("no decoder")),
      loadAudio: () => Promise.reject(new Error("no decoder")),
      load: () => Promise.reject(new Error("no fetch")),
      resolve: (path: string) => `assets/${path}`,
    },
  };
}

describe("the produced files this build commits (specs/assets.md)", () => {
  it("commits every sprite the drawing code asks for", () => {
    for (const path of spritePaths()) {
      expect(existsSync(`assets/${path}`), path).toBe(true);
      expect(statSync(`assets/${path}`).size, path).toBeGreaterThan(0);
    }
  });

  it("commits every produced sound and every particle system", () => {
    for (const cue of CUE_NAMES) {
      expect(existsSync(`assets/${CUE_PATHS[cue]}`), cue).toBe(true);
    }
    for (const name of PARTICLE_NAMES) {
      expect(existsSync(`assets/${PARTICLE_PATHS[name]}`), name).toBe(true);
    }
  });

  it("names each aperture frame under its sheet's directory", () => {
    for (const sheet of ["rise", "set"] as const) {
      for (let frame = 0; frame < APERTURE_FRAMES; frame += 1) {
        expect(aperturePath(sheet, frame)).toBe(
          `${APERTURE_SHEETS[sheet]}/${frame}.png`,
        );
      }
    }
  });

  it("names a path under `assets/` for every mote type", () => {
    for (const [type, path] of Object.entries(MOTE_SPRITE_PATHS)) {
      expect(path).toBe(`sprites/motes/${type}.png`);
      expect(spritePaths()).toContain(path);
    }
  });
});

describe("loading them (specs/assets.md)", () => {
  it("leaves the game running when every load fails", async () => {
    installAssets(new Map(), new Map());
    await expect(loadAssets(failingApi())).resolves.toBeUndefined();
    expect(orrerySprites().get(spritePaths()[0])).toBeNull();
    expect(particleSystemOf("deliver")).toBeNull();
  });

  it("hands the drawing code what it loaded", () => {
    const tile = {} as CanvasImageSource;
    installAssets(new Map([["sprites/motes/sol.png", tile]]), new Map());
    expect(orrerySprites().get("sprites/motes/sol.png")).toBe(tile);
    expect(orrerySprites().get("sprites/motes/luna.png")).toBeNull();
    installAssets(new Map(), new Map());
  });

  it("answers null for a sprite nothing decoded", () => {
    expect(NO_SPRITES.get("sprites/motes/sol.png")).toBeNull();
  });
});
