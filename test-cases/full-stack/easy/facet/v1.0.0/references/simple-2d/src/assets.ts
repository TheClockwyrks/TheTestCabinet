// Facet — the produced files, named once and loaded once.
//
// Everything the game shows and plays other than its chrome was produced by the
// six asset tools and committed under `public/assets/` (specs/assets.md). Vite
// copies that tree into `dist/` unchanged, and the engine resolves every asset
// path under its own root — `assets/`, relative to the page — so a file
// committed at `public/assets/gems/ruby-0.png` is named here as
// `gems/ruby-0.png` and fetched page-relative wherever the site is mounted. A
// root-absolute URL would 404 under the per-run sub-path a build is played back
// from, and the engine refuses to build one.
//
// The manifest below is the single list of what exists. Nothing else in the
// build spells an asset path: the sprites and the particle systems are looked up
// through the store, and the sounds are the cue sources in `src/audio.ts`.
//
// A LOAD THAT FAILS IS NOT FATAL. `initialize` awaits the whole manifest, so a
// browser has every stone cut before the first frame, but a file that does not
// arrive leaves its lookup `null`, is named in {@link LoadProgress.failed}, and
// the renderer falls back for it. That is what a game drawn sixty times a second
// should do with one missing sprite, and it is also what lets this build stand
// up in process, where there is no page for a relative URL to resolve against.

import { GEM_KINDS, MAX_STRAIN } from "./constants";
import type { FacetState } from "./game";
import type { InitApi } from "@test-cabinet/simple-2d";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";

/** How many frames each kind's break sheet holds (`gems/break/<kind>/`). */
export const BREAK_FRAMES = 6;

/** How many frames the prism's idle turn holds (`gems/prism-turn/`). */
export const PRISM_TURN_FRAMES = 8;

/** The rungs of the chain ladder, `chain-1` (lowest) to `chain-8` (highest). */
export const LADDER_RUNGS = 8;

// ---- Keys ----------------------------------------------------------------

/** The key a kind's sprite at one strain is looked up under. */
export function gemKey(kind: string, strain: number): string {
  return `gem:${kind}:${strain}`;
}

/** The key the prism's sprite at one strain is looked up under. */
export function prismKey(strain: number): string {
  return `prism:${strain}`;
}

/** The key one frame of a kind's break sheet is looked up under. */
export function breakKey(kind: string, frame: number): string {
  return `break:${kind}:${frame}`;
}

/** The key one frame of the prism's idle turn is looked up under. */
export function prismTurnKey(frame: number): string {
  return `prism-turn:${frame}`;
}

/** The board frame, the bench surround the field sits on. */
export const FRAME_KEY = "frame";

/** The two cut treatments, composited over a kind's sprite. */
export const CUT_BRILLIANT_KEY = "cut:brilliant";
export const CUT_STAR_KEY = "cut:star";

/** The three particle systems. */
export const FX_CLEAR = "clear-burst";
export const FX_FLAWED = "flawed-burst";
export const FX_CUT = "cut-flash";

// ---- The manifest --------------------------------------------------------

/** Every produced image and system, as `key -> path below the asset root`. */
export interface AssetManifest {
  readonly images: Readonly<Record<string, string>>;
  readonly systems: Readonly<Record<string, string>>;
}

/** Build the manifest. Pure, so a test can assert what the build asks for. */
export function assetManifest(): AssetManifest {
  const images: Record<string, string> = {
    [FRAME_KEY]: "gems/frame.png",
    [CUT_BRILLIANT_KEY]: "gems/cut-brilliant.png",
    [CUT_STAR_KEY]: "gems/cut-star.png",
  };
  for (const kind of GEM_KINDS) {
    for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
      images[gemKey(kind, strain)] = `gems/${kind}-${strain}.png`;
    }
    for (let frame = 0; frame < BREAK_FRAMES; frame += 1) {
      images[breakKey(kind, frame)] = `gems/break/${kind}/${frame}.png`;
    }
  }
  for (let strain = 0; strain <= MAX_STRAIN; strain += 1) {
    images[prismKey(strain)] = `gems/prism-${strain}.png`;
  }
  for (let frame = 0; frame < PRISM_TURN_FRAMES; frame += 1) {
    images[prismTurnKey(frame)] = `gems/prism-turn/${frame}.png`;
  }

  const systems: Record<string, string> = {
    [FX_CLEAR]: "fx/clear-burst.system.json",
    [FX_FLAWED]: "fx/flawed-burst.system.json",
    [FX_CUT]: "fx/cut-flash.system.json",
  };

  return { images, systems };
}

// ---- Fetching ------------------------------------------------------------

/**
 * The two ways a produced file is pulled in, each named by its path below the
 * asset root. It is a seam rather than two direct calls so the store can be
 * exercised in Node, where there is no page to be relative to and the committed
 * files are read straight off disk instead.
 */
export interface AssetIo {
  image(path: string): Promise<CanvasImageSource>;
  json(path: string): Promise<unknown>;
}

/** The engine's own loaders, which resolve every path under its asset root. */
export function engineAssetIo(api: InitApi<FacetState>): AssetIo {
  return {
    image: (path) => api.assets.loadImage(path),
    json: async (path) => {
      const blob = await api.assets.load(path);
      return JSON.parse(await blob.text()) as unknown;
    },
  };
}

/** An `AssetIo` that never yields anything, which is the store's resting state. */
export function noAssetIo(): AssetIo {
  const refuse = (path: string): Promise<never> =>
    Promise.reject(new Error(`Facet: no asset source for ${path}`));
  return { image: refuse, json: refuse };
}

/** How far the load got, and what did not arrive. */
export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  /** Files that failed, by key. A missing file degrades; it never throws. */
  readonly failed: readonly string[];
}

/**
 * The produced sprites and particle systems, once they have arrived.
 *
 * Every lookup answers `null` until its file is in, and a file that failed to
 * load stays `null` and is named in {@link progress}.
 */
export class AssetStore {
  private readonly io: AssetIo;
  private readonly manifest: AssetManifest;
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly systems = new Map<string, ParticleSystem>();
  private readonly failures: string[] = [];
  private count = 0;
  private started: Promise<LoadProgress> | null = null;

  constructor(
    io: AssetIo = noAssetIo(),
    manifest: AssetManifest = assetManifest(),
  ) {
    this.io = io;
    this.manifest = manifest;
  }

  /** The sprite under `key`, or `null` where it is not in. */
  image(key: string): CanvasImageSource | null {
    return this.images.get(key) ?? null;
  }

  /** The parsed particle system under `key`, or `null` where it is not in. */
  system(key: string): ParticleSystem | null {
    return this.systems.get(key) ?? null;
  }

  /** How far the load got. */
  progress(): LoadProgress {
    return {
      loaded: this.count,
      total:
        Object.keys(this.manifest.images).length +
        Object.keys(this.manifest.systems).length,
      failed: [...this.failures],
    };
  }

  /**
   * Start the load, once. Calling again returns the same promise, which settles
   * when every file has either arrived or failed — it never rejects, because
   * one missing file is not a reason to refuse to run.
   */
  load(): Promise<LoadProgress> {
    this.started ??= this.run();
    return this.started;
  }

  private async run(): Promise<LoadProgress> {
    const work: Promise<void>[] = [];
    for (const [key, path] of Object.entries(this.manifest.images)) {
      work.push(
        this.take(key, this.io.image(path), (value) => {
          this.images.set(key, value);
        }),
      );
    }
    for (const [key, path] of Object.entries(this.manifest.systems)) {
      work.push(
        this.take(key, this.io.json(path), (value) => {
          this.systems.set(key, value as ParticleSystem);
        }),
      );
    }
    await Promise.all(work);
    return this.progress();
  }

  /** One file: counted when it lands, recorded when it does not. */
  private async take<T>(
    key: string,
    pending: Promise<T>,
    keep: (value: T) => void,
  ): Promise<void> {
    try {
      keep(await pending);
      this.count += 1;
    } catch {
      this.failures.push(key);
    }
  }
}

/** The whole manifest loaded through the engine, awaited before the first frame. */
export async function loadAssets(
  api: InitApi<FacetState>,
): Promise<AssetStore> {
  const store = new AssetStore(engineAssetIo(api));
  await store.load();
  return store;
}
