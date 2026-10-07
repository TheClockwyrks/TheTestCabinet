// The manifest of produced files, and the store built over it.

import { describe, expect, it } from "vitest";
import {
  assetManifest,
  assets,
  breakKey,
  BREAK_FRAMES,
  buildStore,
  CUT_BRILLIANT_KEY,
  CUT_STAR_KEY,
  emptyStore,
  FRAME_KEY,
  FX_CLEAR,
  FX_AURA,
  FX_CUT,
  FX_FLAWED,
  gemKey,
  prismKey,
  prismTurnKey,
  PRISM_TURN_FRAMES,
  setAssets,
  type AssetIo,
} from "./assets";
import { GEM_KINDS, MAX_STRAIN } from "./constants";

describe("the manifest", () => {
  it("names one sprite per kind per strain state", () => {
    const { images } = assetManifest();
    for (const kind of GEM_KINDS) {
      for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
        expect(images[gemKey(kind, strain)]).toBe(`gems/${kind}-${strain}.png`);
      }
    }
  });

  it("names the prism at every strain state and every turn frame", () => {
    const { images } = assetManifest();
    for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
      expect(images[prismKey(strain)]).toBe(`gems/prism-${strain}.png`);
    }
    for (let frame = 0; frame < PRISM_TURN_FRAMES; frame += 1) {
      expect(images[prismTurnKey(frame)]).toBe(`gems/prism-turn/${frame}.png`);
    }
  });

  it("names a break sheet for every kind", () => {
    const { images } = assetManifest();
    for (const kind of GEM_KINDS) {
      for (let frame = 0; frame < BREAK_FRAMES; frame += 1) {
        expect(images[breakKey(kind, frame)]).toBe(
          `gems/break/${kind}/${frame}.png`,
        );
      }
    }
  });

  it("names the frame, the two cut overlays, and the four systems", () => {
    const manifest = assetManifest();
    expect(manifest.images[FRAME_KEY]).toBe("gems/frame.png");
    expect(manifest.images[CUT_BRILLIANT_KEY]).toBe("gems/cut-brilliant.png");
    expect(manifest.images[CUT_STAR_KEY]).toBe("gems/cut-star.png");
    expect(manifest.systems[FX_CLEAR]).toBe("fx/clear-burst.system.json");
    expect(manifest.systems[FX_FLAWED]).toBe("fx/flawed-burst.system.json");
    expect(manifest.systems[FX_CUT]).toBe("fx/cut-flash.system.json");
    expect(manifest.systems[FX_AURA]).toBe("fx/cut-aura.system.json");
    expect(Object.keys(manifest.systems)).toHaveLength(4);
  });

  it("names every path relative to the engine's own asset root", () => {
    const manifest = assetManifest();
    for (const path of [
      ...Object.values(manifest.images),
      ...Object.values(manifest.systems),
    ]) {
      expect(path.startsWith("/")).toBe(false);
      expect(path).not.toMatch(/\.\./);
      expect(path).not.toMatch(/^[a-z]+:/);
    }
  });
});

describe("the store", () => {
  const io = (fail: readonly string[] = []): AssetIo => ({
    loadImage: async (path) => {
      if (fail.includes(path)) throw new Error(`missing ${path}`);
      return path as unknown as ImageBitmap;
    },
    load: async (path) => {
      if (fail.includes(path)) throw new Error(`missing ${path}`);
      return new Response(JSON.stringify({ path })).blob();
    },
  });

  const manifest = {
    images: { one: "gems/one.png", two: "gems/two.png" },
    systems: { burst: "fx/burst.system.json" },
  };

  it("holds what arrived and counts it", async () => {
    const store = await buildStore(io(), manifest);
    expect(store.loaded()).toBe(3);
    expect(store.failures()).toEqual([]);
    expect(store.image("one")).toBe("gems/one.png");
    expect(store.system("burst")).toEqual({ path: "fx/burst.system.json" });
  });

  it("records a file that failed rather than rejecting", async () => {
    const store = await buildStore(io(["gems/two.png"]), manifest);
    expect(store.loaded()).toBe(2);
    expect(store.failures()).toEqual(["two"]);
    expect(store.image("two")).toBeNull();
    expect(store.image("nothing")).toBeNull();
    expect(store.system("nothing")).toBeNull();
  });

  it("answers null for everything before a load has run", () => {
    const store = emptyStore();
    expect(store.image(FRAME_KEY)).toBeNull();
    expect(store.system(FX_CLEAR)).toBeNull();
    expect(store.loaded()).toBe(0);
    expect(store.failures()).toEqual([]);
  });

  it("is installed as the one the build draws from", async () => {
    const before = assets();
    try {
      const store = await buildStore(io(), manifest);
      setAssets(store);
      expect(assets().image("one")).toBe("gems/one.png");
    } finally {
      setAssets(before);
    }
  });
});
