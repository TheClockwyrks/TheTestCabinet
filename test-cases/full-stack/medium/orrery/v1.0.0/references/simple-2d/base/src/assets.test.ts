// What this build asks the engine's loader for, and what it does with what
// comes back (specs/assets.md, ASSET-LAYOUT.md).
//
// The loader itself is the engine's, so what is checked here is Orrery's half:
// that every produced file is named, under the path `src/constants.ts` states
// relative to the one asset root; that the paths are asked for and nothing
// else; and that a file that does not arrive leaves the set usable rather than
// failing the whole load.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { aperturePath, isSystem, loadSprites, loadSystems } from "./assets";
import {
  APERTURE_FRAMES,
  APERTURE_SHEETS,
  CUE_PATHS,
  MOTE_SPRITE_PATHS,
  PARTICLE_PATHS,
} from "./constants";
import { CUE_NAMES } from "./figures";

/** An assets api that records what it was asked for and answers as told. */
function loader(answer: (path: string) => Promise<unknown>) {
  const asked: string[] = [];
  return {
    asked,
    api: {
      assets: {
        loadImage: async (path: string): Promise<ImageBitmap> => {
          asked.push(path);
          return (await answer(path)) as ImageBitmap;
        },
        loadAudio: (): Promise<AudioBuffer> => {
          throw new Error("not used");
        },
        load: async (path: string): Promise<Blob> => {
          asked.push(path);
          return (await answer(path)) as Blob;
        },
        resolve: (path: string) => path,
      },
    },
  };
}

/** A blob standing in for a fetched file, with only the parts used here. */
function blobOf(body: string): Blob {
  return { text: () => Promise.resolve(body) } as unknown as Blob;
}

describe("the paths this build asks for (specs/assets.md)", () => {
  it("writes every path relative to the asset root, never rooted", () => {
    const paths = [
      ...Object.values(MOTE_SPRITE_PATHS),
      ...Object.values(PARTICLE_PATHS),
      ...Object.values(CUE_PATHS),
      aperturePath("rise", 0),
    ];
    for (const path of paths) {
      expect(path.startsWith("/"), path).toBe(false);
      expect(path.startsWith("http"), path).toBe(false);
      expect(path.startsWith("assets/"), path).toBe(false);
    }
  });

  it("numbers an aperture sheet's frames under its own directory", () => {
    for (let frame = 0; frame < APERTURE_FRAMES; frame += 1) {
      expect(aperturePath("set", frame)).toBe(
        `${APERTURE_SHEETS.set}/${frame}.png`,
      );
    }
  });

  it("names one produced file per cue, the bed included", () => {
    expect(Object.keys(CUE_PATHS).sort()).toEqual([...CUE_NAMES].sort());
    for (const cue of CUE_NAMES) {
      expect(CUE_PATHS[cue].endsWith(".wav"), cue).toBe(true);
    }
  });
});

describe("decoding the produced sprites (specs/assets.md)", () => {
  it("asks the loader for exactly the paths it was given", async () => {
    const { api, asked } = loader(() => Promise.resolve({}));
    await loadSprites(api, ["sprites/motes/sol.png", "sprites/parts/hub.png"]);
    expect(asked).toEqual(["sprites/motes/sol.png", "sprites/parts/hub.png"]);
  });

  it("keeps the rest of the set when one file will not arrive", async () => {
    const { api } = loader((path) =>
      path.includes("sol")
        ? Promise.reject(new Error("404"))
        : Promise.resolve({}),
    );
    const decoded = await loadSprites(api, [
      "sprites/motes/sol.png",
      "sprites/motes/luna.png",
    ]);
    expect(decoded.has("sprites/motes/sol.png")).toBe(false);
    expect(decoded.has("sprites/motes/luna.png")).toBe(true);
  });
});

describe("the produced particle systems (specs/assets.md)", () => {
  it("parses each committed document and holds it by name", async () => {
    const { api } = loader((path) => {
      const url = new URL(`../assets/${path}`, import.meta.url);
      return Promise.resolve(blobOf(readFileSync(url, "utf8")));
    });
    const systems = await loadSystems(api);
    expect([...systems.keys()].sort()).toEqual(
      Object.keys(PARTICLE_PATHS).sort(),
    );
  });

  it("leaves out a system that will not arrive or will not parse", async () => {
    const { api } = loader((path) =>
      path.includes("fault")
        ? Promise.reject(new Error("404"))
        : Promise.resolve(blobOf("{ not json")),
    );
    expect((await loadSystems(api)).size).toBe(0);
  });

  it("refuses a document that is not a particle system at all", () => {
    expect(isSystem(null)).toBe(false);
    expect(isSystem({ durationMs: 1, field: {} })).toBe(false);
    expect(isSystem({ durationMs: 1, field: {}, emitters: [] })).toBe(true);
  });
});
