import { afterEach, describe, expect, it, vi } from "vitest";

import { createCanvas, ImageData as NodeImageData } from "@napi-rs/canvas";

import { deriveArt, type Raster } from "./art";
import { BURST_SYSTEM, SPRITES, SPRITE_SIZE } from "./constants";
import { loadSeededRasters, seededBurstSystem } from "./harness.test-support";
import { ASSET_ROOT, assetUrl, loadBurstSystem, toSprites } from "./images";

const globals = globalThis as unknown as Record<string, unknown>;
const kept = {
  document: globals.document,
  ImageData: globals.ImageData,
  fetch: globals.fetch,
};

/** Stand a page up whose base URI a test names. */
function page(baseURI: string): void {
  globals.document = {
    baseURI,
    createElement: () => createCanvas(SPRITE_SIZE, SPRITE_SIZE),
  };
  globals.ImageData = NodeImageData;
}

afterEach(() => {
  globals.document = kept.document;
  globals.ImageData = kept.ImageData;
  globals.fetch = kept.fetch;
});

describe("where the seeded art is asked for", () => {
  it("resolves every name against the page, not the origin root", () => {
    page("https://example.test/games/spectra/index.html");
    expect(assetUrl(SPRITES.shard)).toBe(
      `https://example.test/games/spectra/${ASSET_ROOT}/shard.png`,
    );
    expect(assetUrl(BURST_SYSTEM)).toBe(
      `https://example.test/games/spectra/${ASSET_ROOT}/${BURST_SYSTEM}`,
    );
  });

  it("runs the same at the root of a host and under a sub-path of it", () => {
    page("https://example.test/");
    expect(assetUrl(SPRITES.fighter)).toBe(
      `https://example.test/${ASSET_ROOT}/fighter.png`,
    );
    page("https://example.test/deeply/nested/");
    expect(assetUrl(SPRITES.fighter)).toBe(
      `https://example.test/deeply/nested/${ASSET_ROOT}/fighter.png`,
    );
  });

  it("asks for each of the four sprites and the one system by name", () => {
    page("https://example.test/");
    const names = [...Object.values(SPRITES), BURST_SYSTEM];
    expect(names).toEqual([
      "fighter.png",
      "shard.png",
      "flux.png",
      "prism.png",
      "drone-burst.json",
    ]);
    for (const name of names) {
      expect(assetUrl(name).endsWith(`/${ASSET_ROOT}/${name}`)).toBe(true);
    }
  });
});

describe("fetching the seeded system", () => {
  it("parses what the page hands back", async () => {
    page("https://example.test/");
    const system = seededBurstSystem();
    globals.fetch = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => Promise.resolve(system),
      }),
    );
    await expect(loadBurstSystem()).resolves.toEqual(system);
    expect(globals.fetch).toHaveBeenCalledWith(
      `https://example.test/${ASSET_ROOT}/${BURST_SYSTEM}`,
    );
  });

  it("names the URL that went missing", async () => {
    page("https://example.test/");
    globals.fetch = vi.fn(async () =>
      Promise.resolve({ ok: false, status: 404, json: async () => ({}) }),
    );
    await expect(loadBurstSystem()).rejects.toThrow(/404/);
  });
});

describe("turning the derived rasters into sprites", () => {
  it("gives every band-state something drawImage accepts", async () => {
    page("https://example.test/");
    const sources = await loadSeededRasters();
    const rasters = deriveArt({
      fighter: sources.fighter as Raster,
      shard: sources.shard as Raster,
      flux: sources.flux as Raster,
      prism: sources.prism as Raster,
    });
    const sprites = toSprites(rasters);
    const every = [
      sprites.fighter.cyan,
      sprites.fighter.magenta,
      sprites.shard.cyan,
      sprites.shard.magenta,
      sprites.fluxHeld.cyan,
      sprites.fluxHeld.magenta,
      sprites.fluxShimmer,
      sprites.prismFull.cyan,
      sprites.prismFull.magenta,
      sprites.prismCore.cyan,
      sprites.prismCore.magenta,
    ];
    expect(every.length).toBe(11);
    for (const sprite of every) {
      const canvas = sprite as unknown as { width: number; height: number };
      expect(canvas.width).toBe(SPRITE_SIZE);
      expect(canvas.height).toBe(SPRITE_SIZE);
    }
    // And the pixels really made it across.
    const drawn = sprites.shard.cyan as unknown as ReturnType<
      typeof createCanvas
    >;
    const data = drawn
      .getContext("2d")
      .getImageData(0, 0, SPRITE_SIZE, SPRITE_SIZE).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4)
      if ((data[i] ?? 0) > 0) opaque += 1;
    expect(opaque).toBeGreaterThan(500);
  });
});
