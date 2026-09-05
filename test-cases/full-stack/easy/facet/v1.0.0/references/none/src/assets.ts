// Facet — the produced files, named once and loaded once.
//
// Everything the game shows and plays other than its chrome was produced by
// the six asset tools and committed under `public/assets/` (specs/assets.md).
// Vite copies that tree into `dist/` unchanged, so this module names each file
// by the path it is SERVED at, PAGE-RELATIVE — `assets/gems/ruby-0.png`, never
// `/assets/...` — because the built site is played back mounted under a
// per-run sub-path and a root-absolute URL would 404 there.
//
// The manifest below is the single list of what exists; the loader under it
// fetches the list and hands the rest of the build three lookups: an image, a
// parsed particle system, and the undecoded bytes of a sound. Nothing else in
// the build spells an asset path.
//
// LOADING IS ASYNCHRONOUS AND THE GAME DOES NOT WAIT FOR IT. The frame loop and
// `window.__facet` are up from the first tick, and each lookup answers `null`
// until its file has arrived, so a frame drawn before the stones are cut draws
// the fallback in `src/render.gems.ts` and the next one draws the sprite. The
// alternative — holding the first frame until 108 files land — would leave the
// debug surface unreachable for as long as the network takes, which is exactly
// what `specs/instrumentation.md` asks the build not to do.

import { GEM_KINDS, MAX_STRAIN } from "./constants";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";

/** The directory the produced tree is served at, relative to the page. */
export const ASSET_ROOT = "assets/";

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

/** The key one rung of the chain ladder is looked up under. */
export function ladderKey(rung: number): string {
  return `chain-${rung}`;
}

/** The board frame, the bench surround the field sits on. */
export const FRAME_KEY = "frame";

/** The two cut treatments, composited over a kind's sprite. */
export const CUT_BRILLIANT_KEY = "cut:brilliant";
export const CUT_STAR_KEY = "cut:star";

/** The four particle systems. Three are one-shots; {@link FX_AURA} loops. */
export const FX_CLEAR = "clear-burst";
export const FX_FLAWED = "flawed-burst";
export const FX_CUT = "cut-flash";
export const FX_AURA = "cut-aura";

/** The two music beds. */
export const MUSIC_TITLE = "title";
export const MUSIC_PLAY = "play";

// ---- The manifest --------------------------------------------------------

/** Every produced file, as `key -> path below {@link ASSET_ROOT}`. */
export interface AssetManifest {
  readonly images: Readonly<Record<string, string>>;
  readonly systems: Readonly<Record<string, string>>;
  readonly sounds: Readonly<Record<string, string>>;
}

/** Build the manifest. Pure, so a test can assert what the build asks for. */
export function assetManifest(): AssetManifest {
  const images: Record<string, string> = {
    [FRAME_KEY]: "gems/frame.png",
    [CUT_BRILLIANT_KEY]: "gems/cut-brilliant.png",
    [CUT_STAR_KEY]: "gems/cut-star.png",
  };
  for (const kind of GEM_KINDS) {
    for (let strain = 0; strain <= MAX_STRAIN; strain++) {
      images[gemKey(kind, strain)] = `gems/${kind}-${strain}.png`;
    }
    for (let frame = 0; frame < BREAK_FRAMES; frame++) {
      images[breakKey(kind, frame)] = `gems/break/${kind}/${frame}.png`;
    }
  }
  for (let strain = 0; strain <= MAX_STRAIN; strain++) {
    images[prismKey(strain)] = `gems/prism-${strain}.png`;
  }
  for (let frame = 0; frame < PRISM_TURN_FRAMES; frame++) {
    images[prismTurnKey(frame)] = `gems/prism-turn/${frame}.png`;
  }

  const systems: Record<string, string> = {
    [FX_CLEAR]: "fx/clear-burst.system.json",
    [FX_FLAWED]: "fx/flawed-burst.system.json",
    [FX_CUT]: "fx/cut-flash.system.json",
    [FX_AURA]: "fx/cut-aura.system.json",
  };

  const sounds: Record<string, string> = {
    select: "audio/select.wav",
    swap: "audio/swap.wav",
    refuse: "audio/refuse.wav",
    land: "audio/land.wav",
    flaw: "audio/flaw.wav",
    cut: "audio/cut.wav",
    levelup: "audio/levelup.wav",
    gameover: "audio/gameover.wav",
    shatter: "audio/shatter.wav",
    [MUSIC_TITLE]: "audio/title.wav",
    [MUSIC_PLAY]: "audio/play.wav",
  };
  for (let rung = 1; rung <= LADDER_RUNGS; rung++) {
    sounds[ladderKey(rung)] = `audio/chain-${rung}.wav`;
  }

  return { images, systems, sounds };
}

// ---- Fetching ------------------------------------------------------------

/**
 * The three ways a file is pulled off the page's origin. It is a seam rather
 * than three direct calls so the store can be exercised in Node, where there
 * is no `Image` and no page to be relative to.
 */
export interface AssetIo {
  image(url: string): Promise<CanvasImageSource>;
  json(url: string): Promise<unknown>;
  bytes(url: string): Promise<ArrayBuffer>;
}

/** The browser's own loaders. */
export function domAssetIo(): AssetIo {
  return {
    image: (url) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          resolve(image);
        };
        image.onerror = () => {
          reject(new Error(`Facet: could not load the image at ${url}`));
        };
        image.src = url;
      }),
    json: async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Facet: could not load ${url} (${response.status})`);
      }
      return response.json();
    },
    bytes: async (url) => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Facet: could not load ${url} (${response.status})`);
      }
      return response.arrayBuffer();
    },
  };
}

/** How far the load has got, which the title screen reports while it runs. */
export interface LoadProgress {
  readonly loaded: number;
  readonly total: number;
  /** Files that failed, by key. A missing file degrades; it never throws. */
  readonly failed: readonly string[];
}

/**
 * The produced files, once they have arrived.
 *
 * Every lookup answers `null` until its file is in, and a file that fails to
 * load simply stays `null` and is named in {@link progress}: a game missing one
 * sprite keeps running, which is the only behavior that makes sense for
 * something drawn sixty times a second.
 */
export class AssetStore {
  private readonly io: AssetIo;
  private readonly root: string;
  private readonly manifest: AssetManifest;
  private readonly images = new Map<string, CanvasImageSource>();
  private readonly systems = new Map<string, ParticleSystem>();
  private readonly sounds = new Map<string, ArrayBuffer>();
  private readonly failures: string[] = [];
  private loaded = 0;
  private started: Promise<LoadProgress> | null = null;

  constructor(
    io: AssetIo = domAssetIo(),
    manifest: AssetManifest = assetManifest(),
    root: string = ASSET_ROOT,
  ) {
    this.io = io;
    this.manifest = manifest;
    this.root = root;
  }

  /** The sprite under `key`, or `null` until it has arrived. */
  image(key: string): CanvasImageSource | null {
    return this.images.get(key) ?? null;
  }

  /** The parsed particle system under `key`, or `null` until it has arrived. */
  system(key: string): ParticleSystem | null {
    return this.systems.get(key) ?? null;
  }

  /** The undecoded bytes of the sound under `key`, or `null` until it is in. */
  sound(key: string): ArrayBuffer | null {
    return this.sounds.get(key) ?? null;
  }

  /** Every sound key the manifest names, which is what the bus decodes. */
  soundKeys(): string[] {
    return Object.keys(this.manifest.sounds);
  }

  /** How far the load has got. */
  progress(): LoadProgress {
    return {
      loaded: this.loaded,
      total:
        Object.keys(this.manifest.images).length +
        Object.keys(this.manifest.systems).length +
        Object.keys(this.manifest.sounds).length,
      failed: [...this.failures],
    };
  }

  /** Whether every sprite the board draws with is in, failures aside. */
  ready(): boolean {
    const progress = this.progress();
    return progress.loaded + progress.failed.length >= progress.total;
  }

  /**
   * Start the load, once. Calling again returns the same promise, which
   * settles when every file has either arrived or failed — it never rejects,
   * because one missing sound is not a reason to stop the game.
   */
  load(): Promise<LoadProgress> {
    this.started ??= this.run();
    return this.started;
  }

  private async run(): Promise<LoadProgress> {
    const work: Promise<void>[] = [];
    for (const [key, path] of Object.entries(this.manifest.images)) {
      work.push(
        this.take(key, this.io.image(this.root + path), (value) => {
          this.images.set(key, value);
        }),
      );
    }
    for (const [key, path] of Object.entries(this.manifest.systems)) {
      work.push(
        this.take(key, this.io.json(this.root + path), (value) => {
          this.systems.set(key, value as ParticleSystem);
        }),
      );
    }
    for (const [key, path] of Object.entries(this.manifest.sounds)) {
      work.push(
        this.take(key, this.io.bytes(this.root + path), (value) => {
          this.sounds.set(key, value);
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
      this.loaded += 1;
    } catch {
      this.failures.push(key);
    }
  }
}
