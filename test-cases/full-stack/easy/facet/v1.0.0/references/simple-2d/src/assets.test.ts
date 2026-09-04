import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AssetStore,
  BREAK_FRAMES,
  CUT_BRILLIANT_KEY,
  CUT_STAR_KEY,
  FRAME_KEY,
  FX_AURA,
  FX_CLEAR,
  FX_CUT,
  FX_FLAWED,
  PRISM_TURN_FRAMES,
  assetManifest,
  breakKey,
  engineAssetIo,
  gemKey,
  noAssetIo,
  prismKey,
  prismTurnKey,
  type AssetIo,
} from "./assets";
import { cueSources } from "./audio";
import { GEM_KINDS, MAX_STRAIN } from "./constants";
import type { FacetState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";

const ASSETS = join(import.meta.dirname, "..", "public", "assets");

/** Every committed file under `public/assets/`, named below that directory. */
function committed(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else found.push(relative(ASSETS, full).split(sep).join("/"));
    }
  };
  walk(ASSETS);
  return found.sort();
}

describe("the manifest", () => {
  it("names every sprite specs/assets.md asks for", () => {
    const { images } = assetManifest();
    expect(images[FRAME_KEY]).toBe("gems/frame.png");
    expect(images[CUT_BRILLIANT_KEY]).toBe("gems/cut-brilliant.png");
    expect(images[CUT_STAR_KEY]).toBe("gems/cut-star.png");
    for (const kind of GEM_KINDS) {
      for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
        expect(images[gemKey(kind, strain)]).toBe(`gems/${kind}-${strain}.png`);
      }
      for (let frame = 0; frame < BREAK_FRAMES; frame += 1) {
        expect(images[breakKey(kind, frame)]).toBe(
          `gems/break/${kind}/${frame}.png`,
        );
      }
    }
    for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
      expect(images[prismKey(strain)]).toBe(`gems/prism-${strain}.png`);
    }
    for (let frame = 0; frame < PRISM_TURN_FRAMES; frame += 1) {
      expect(images[prismTurnKey(frame)]).toBe(`gems/prism-turn/${frame}.png`);
    }
  });

  it("names the four particle systems", () => {
    const { systems } = assetManifest();
    expect(systems[FX_CLEAR]).toBe("fx/clear-burst.system.json");
    expect(systems[FX_FLAWED]).toBe("fx/flawed-burst.system.json");
    expect(systems[FX_CUT]).toBe("fx/cut-flash.system.json");
    expect(systems[FX_AURA]).toBe("fx/cut-aura.system.json");
  });

  it("asks for nothing that is not committed", () => {
    const files = new Set(committed());
    const manifest = assetManifest();
    for (const path of Object.values(manifest.images)) {
      expect(files.has(path), path).toBe(true);
    }
    for (const path of Object.values(manifest.systems)) {
      expect(files.has(path), path).toBe(true);
    }
    for (const path of Object.values(cueSources())) {
      expect(files.has(path), path).toBe(true);
    }
  });

  it("leaves nothing committed unasked for but the scores", () => {
    // `music` emits a portable `.mid` beside each `.wav`; the game plays the
    // `.wav` and ships the score alongside it (specs/assets.md).
    const asked = new Set([
      ...Object.values(assetManifest().images),
      ...Object.values(assetManifest().systems),
      ...Object.values(cueSources()),
    ]);
    const unasked = committed().filter((path) => !asked.has(path));
    expect(unasked).toEqual(["audio/play.mid", "audio/title.mid"]);
  });

  it("names every path relative to the asset root, never from the origin", () => {
    for (const path of [
      ...Object.values(assetManifest().images),
      ...Object.values(assetManifest().systems),
      ...Object.values(cueSources()),
    ]) {
      expect(path.startsWith("/"), path).toBe(false);
      expect(path.includes(".."), path).toBe(false);
    }
  });
});

describe("the store", () => {
  /** An io that hands back a marker for one path and refuses the rest. */
  function partialIo(good: string): AssetIo {
    return {
      image: (path) =>
        path === good
          ? Promise.resolve({} as CanvasImageSource)
          : Promise.reject(new Error("missing")),
      json: () => Promise.reject(new Error("missing")),
    };
  }

  it("answers null for everything before anything has loaded", () => {
    const store = new AssetStore();
    expect(store.image(FRAME_KEY)).toBeNull();
    expect(store.system(FX_CLEAR)).toBeNull();
    expect(store.progress().loaded).toBe(0);
  });

  it("keeps what arrived and names what did not", async () => {
    const store = new AssetStore(partialIo("gems/frame.png"));
    const progress = await store.load();

    expect(store.image(FRAME_KEY)).not.toBeNull();
    expect(store.image(gemKey("ruby", 0))).toBeNull();
    expect(progress.loaded).toBe(1);
    expect(progress.total).toBe(89);
    expect(progress.failed).toHaveLength(88);
  });

  it("loads once however often it is asked", async () => {
    let calls = 0;
    const store = new AssetStore({
      image: () => {
        calls += 1;
        return Promise.reject(new Error("missing"));
      },
      json: () => Promise.reject(new Error("missing")),
    });
    await Promise.all([store.load(), store.load()]);
    await store.load();
    expect(calls).toBe(Object.keys(assetManifest().images).length);
  });

  it("refuses every path when it has no source at all", async () => {
    const store = new AssetStore(noAssetIo());
    const progress = await store.load();
    expect(progress.loaded).toBe(0);
    expect(progress.failed).toHaveLength(progress.total);
  });
});

describe("the engine's io", () => {
  it("asks the engine for each path, and parses a system out of its blob", async () => {
    const asked: string[] = [];
    const api = {
      assets: {
        loadImage: (path: string) => {
          asked.push(path);
          return Promise.resolve({} as ImageBitmap);
        },
        load: (path: string) => {
          asked.push(path);
          return Promise.resolve(new Blob(['{"ok":true}']));
        },
        loadAudio: () => Promise.reject(new Error("unused")),
        resolve: (path: string) => `assets/${path}`,
      },
    } as unknown as InitApi<FacetState>;

    const io = engineAssetIo(api);
    await io.image("gems/frame.png");
    expect(await io.json("fx/clear-burst.system.json")).toEqual({ ok: true });
    expect(asked).toEqual(["gems/frame.png", "fx/clear-burst.system.json"]);
  });
});
