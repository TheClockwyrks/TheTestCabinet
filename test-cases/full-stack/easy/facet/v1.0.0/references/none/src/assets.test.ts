import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_ROOT,
  AssetStore,
  domAssetIo,
  BREAK_FRAMES,
  CUT_BRILLIANT_KEY,
  CUT_STAR_KEY,
  FRAME_KEY,
  FX_CLEAR,
  FX_CUT,
  FX_FLAWED,
  LADDER_RUNGS,
  MUSIC_PLAY,
  MUSIC_TITLE,
  PRISM_TURN_FRAMES,
  assetManifest,
  breakKey,
  gemKey,
  ladderKey,
  prismKey,
  prismTurnKey,
  type AssetIo,
} from "./assets";
import { CUES, GEM_KINDS, MAX_STRAIN } from "./constants";

/** Every file the manifest names, as a path under `public/`. */
function committedPath(path: string): string {
  return resolve(import.meta.dirname, "..", "public", ASSET_ROOT + path);
}

/** An io that answers instantly, and fails for the keys it is told to. */
function fakeIo(failing: readonly string[] = []): AssetIo {
  const fail = (url: string): boolean =>
    failing.some((needle) => url.includes(needle));
  return {
    image: (url) =>
      fail(url)
        ? Promise.reject(new Error("no"))
        : Promise.resolve({} as CanvasImageSource),
    json: (url) =>
      fail(url) ? Promise.reject(new Error("no")) : Promise.resolve({ url }),
    bytes: (url) =>
      fail(url)
        ? Promise.reject(new Error("no"))
        : Promise.resolve(new ArrayBuffer(4)),
  };
}

describe("the manifest", () => {
  const manifest = assetManifest();

  it("names every kind at every strain state", () => {
    for (const kind of GEM_KINDS) {
      for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
        expect(manifest.images[gemKey(kind, strain)]).toBe(
          `gems/${kind}-${strain}.png`,
        );
      }
    }
  });

  it("names the prism at every strain state, its turn, and the two cuts", () => {
    for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
      expect(manifest.images[prismKey(strain)]).toBeDefined();
    }
    for (let frame = 0; frame < PRISM_TURN_FRAMES; frame += 1) {
      expect(manifest.images[prismTurnKey(frame)]).toBeDefined();
    }
    expect(manifest.images[CUT_BRILLIANT_KEY]).toBeDefined();
    expect(manifest.images[CUT_STAR_KEY]).toBeDefined();
    expect(manifest.images[FRAME_KEY]).toBeDefined();
  });

  it("names a break sheet for each of the seven kinds", () => {
    for (const kind of GEM_KINDS) {
      for (let frame = 0; frame < BREAK_FRAMES; frame += 1) {
        expect(manifest.images[breakKey(kind, frame)]).toBe(
          `gems/break/${kind}/${frame}.png`,
        );
      }
    }
  });

  it("names the three particle systems", () => {
    expect(Object.keys(manifest.systems).sort()).toEqual(
      [FX_CLEAR, FX_CUT, FX_FLAWED].sort(),
    );
  });

  it("names a sound for each of the eight cues, the ladder, and the music", () => {
    for (const cue of Object.values(CUES)) {
      if (cue === CUES.clear) continue;
      expect(manifest.sounds[cue]).toBeDefined();
    }
    expect(manifest.sounds.shatter).toBeDefined();
    for (let rung = 1; rung <= LADDER_RUNGS; rung += 1) {
      expect(manifest.sounds[ladderKey(rung)]).toBeDefined();
    }
    expect(manifest.sounds[MUSIC_TITLE]).toBeDefined();
    expect(manifest.sounds[MUSIC_PLAY]).toBeDefined();
  });

  it("references every file page-relative, never from the origin root", () => {
    const every = [
      ...Object.values(manifest.images),
      ...Object.values(manifest.systems),
      ...Object.values(manifest.sounds),
    ];
    expect(ASSET_ROOT.startsWith("/")).toBe(false);
    for (const path of every) expect(path.startsWith("/")).toBe(false);
  });

  it("names only files this repository actually committed", () => {
    const every = [
      ...Object.values(assetManifest().images),
      ...Object.values(assetManifest().systems),
      ...Object.values(assetManifest().sounds),
    ];
    for (const path of every) {
      expect(() => readFileSync(committedPath(path))).not.toThrow();
    }
  });
});

describe("AssetStore", () => {
  it("answers null for everything until the load has run", () => {
    const store = new AssetStore(fakeIo());
    expect(store.image(FRAME_KEY)).toBeNull();
    expect(store.system(FX_CLEAR)).toBeNull();
    expect(store.sound("select")).toBeNull();
    expect(store.ready()).toBe(false);
  });

  it("holds every file once the load has settled", async () => {
    const store = new AssetStore(fakeIo());
    const progress = await store.load();
    expect(progress.failed).toEqual([]);
    expect(progress.loaded).toBe(progress.total);
    expect(store.ready()).toBe(true);
    expect(store.image(FRAME_KEY)).not.toBeNull();
    expect(store.system(FX_CLEAR)).not.toBeNull();
    expect(store.sound(ladderKey(3))).not.toBeNull();
  });

  it("records a file that failed and keeps the rest", async () => {
    const store = new AssetStore(fakeIo(["frame.png"]));
    const progress = await store.load();
    expect(progress.failed).toEqual([FRAME_KEY]);
    expect(store.image(FRAME_KEY)).toBeNull();
    expect(store.image(gemKey("ruby", 0))).not.toBeNull();
    // A settled load counts as ready even with a hole in it: the game does not
    // wait on a file that is never coming.
    expect(store.ready()).toBe(true);
  });

  it("starts the load once, however many times it is asked", async () => {
    let calls = 0;
    const io = fakeIo();
    const counted: AssetIo = {
      ...io,
      image: (url) => {
        calls += 1;
        return io.image(url);
      },
    };
    const store = new AssetStore(counted);
    await Promise.all([store.load(), store.load()]);
    expect(calls).toBe(Object.keys(assetManifest().images).length);
  });

  it("lists every sound key, which is what the bus decodes", () => {
    const store = new AssetStore(fakeIo());
    expect(store.soundKeys().sort()).toEqual(
      Object.keys(assetManifest().sounds).sort(),
    );
  });
});

describe("domAssetIo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** An `Image` that reports success or failure the moment a src is set. */
  function stubImage(succeeds: boolean): void {
    vi.stubGlobal(
      "Image",
      class {
        decoding = "auto";
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => (succeeds ? this.onload?.() : this.onerror?.()));
        }
      },
    );
  }

  it("resolves an image once the browser has decoded it", async () => {
    stubImage(true);
    await expect(
      domAssetIo().image("assets/gems/ruby-0.png"),
    ).resolves.toBeDefined();
  });

  it("rejects an image the browser could not load", async () => {
    stubImage(false);
    await expect(domAssetIo().image("assets/nope.png")).rejects.toThrow(
      /could not load/,
    );
  });

  it("fetches a particle system and a sound off the page's own origin", async () => {
    vi.stubGlobal("fetch", (url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ url }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      }),
    );
    const io = domAssetIo();
    await expect(io.json("assets/fx/clear-burst.system.json")).resolves.toEqual(
      {
        url: "assets/fx/clear-burst.system.json",
      },
    );
    await expect(io.bytes("assets/audio/select.wav")).resolves.toHaveProperty(
      "byteLength",
      8,
    );
  });

  it("names the file and the status when a fetch comes back wrong", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status: 404 }));
    const io = domAssetIo();
    await expect(io.json("assets/fx/missing.json")).rejects.toThrow(/404/);
    await expect(io.bytes("assets/audio/missing.wav")).rejects.toThrow(/404/);
  });
});
