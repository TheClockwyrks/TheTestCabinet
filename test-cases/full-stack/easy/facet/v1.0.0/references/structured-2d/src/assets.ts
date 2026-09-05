// Facet — the produced files, named once and loaded once.
//
// Everything the game shows other than its chrome was produced by the six asset
// tools and committed under `public/assets/` (specs/assets.md). Vite copies
// that tree into `dist/` unchanged, and the engine resolves every asset path
// under its own root — `assets/`, relative to the page — so a file committed at
// `public/assets/gems/ruby-0.png` is named here as `gems/ruby-0.png` and is
// fetched page-relative wherever the build is mounted. No path in this build is
// root-absolute, which is what keeps `dist/` working under the per-run sub-path
// it is played back from.
//
// The manifest below is the single list of what exists; nothing else in the
// build spells an asset path. The load runs in the LEVEL'S `load`, which the
// engine awaits before any actor of that level exists, so the bench is
// constructed with its art already in hand and the first frame draws the
// finished board rather than a half-loaded one (engine/assets.md).
//
// The store is held at module scope, which is the engine's own documented place
// for what a level's `load` produced. It is not game state: it is a fixed set
// of decoded files, identical on every run, and nothing about the game's
// behavior is read back out of it.
//
// A FILE THAT FAILS TO LOAD IS RECORDED, NOT THROWN. A rejection escaping the
// level's `load` would reject `engine.initialize` and run no frame at all, so
// one missing sprite would cost the whole game; instead its lookup answers
// `null`, the renderer draws the fallback beside it, and `failures()` names it.

import type { LoadApi } from "@clockwyrks/structured-2d";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import { GEM_KINDS, MAX_STRAIN } from "./constants";

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

/**
 * The four particle systems: three one-shots a chain throws, and the looping
 * aura every cut stone standing on the board carries (specs/assets.md).
 */
export const FX_CLEAR = "clear-burst";
export const FX_FLAWED = "flawed-burst";
export const FX_CUT = "cut-flash";
export const FX_AURA = "cut-aura";

// ---- The manifest --------------------------------------------------------

/** Every produced file the store holds, as `key -> path below the root`. */
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
    [FX_AURA]: "fx/cut-aura.system.json",
  };

  return { images, systems };
}

// ---- The store -----------------------------------------------------------

/** The decoded files, once the level's `load` has resolved. */
export interface AssetStore {
  /** The sprite under `key`, or `null` when it is not in. */
  image(key: string): ImageBitmap | null;
  /** The parsed particle system under `key`, or `null` when it is not in. */
  system(key: string): ParticleSystem | null;
  /** How many of the manifest's files arrived. */
  loaded(): number;
  /** The keys of the files that did not, in the order they failed. */
  failures(): readonly string[];
}

/** A store holding nothing, which is what the build carries before it loads. */
export function emptyStore(): AssetStore {
  return {
    image: () => null,
    system: () => null,
    loaded: () => 0,
    failures: () => [],
  };
}

/** The loaders the store is built over: exactly what `LoadApi.assets` offers. */
export interface AssetIo {
  loadImage(path: string): Promise<ImageBitmap>;
  load(path: string): Promise<Blob>;
}

/**
 * Fetch and decode every file the manifest names, recording each failure
 * rather than rejecting. Split from `loadAssets` so a test drives it over
 * loaders of its own.
 */
export async function buildStore(
  io: AssetIo,
  manifest: AssetManifest = assetManifest(),
): Promise<AssetStore> {
  const images = new Map<string, ImageBitmap>();
  const systems = new Map<string, ParticleSystem>();
  const failures: string[] = [];
  let loaded = 0;

  const take = async <T>(
    key: string,
    pending: Promise<T>,
    keep: (value: T) => void,
  ): Promise<void> => {
    try {
      keep(await pending);
      loaded += 1;
    } catch {
      failures.push(key);
    }
  };

  const work: Promise<void>[] = [];
  for (const [key, path] of Object.entries(manifest.images)) {
    work.push(
      take(key, io.loadImage(path), (image) => {
        images.set(key, image);
      }),
    );
  }
  for (const [key, path] of Object.entries(manifest.systems)) {
    work.push(
      take(
        key,
        io.load(path).then(async (blob) => JSON.parse(await blob.text())),
        (system) => {
          systems.set(key, system as ParticleSystem);
        },
      ),
    );
  }
  await Promise.all(work);

  return {
    image: (key) => images.get(key) ?? null,
    system: (key) => systems.get(key) ?? null,
    loaded: () => loaded,
    failures: () => [...failures],
  };
}

/**
 * What the level's `load` produced. Read it wherever the art is drawn; it holds
 * an empty store until the load has run, so a module that reads it at import
 * time gets an answer rather than an error.
 */
let store: AssetStore = emptyStore();

/** The produced files. */
export function assets(): AssetStore {
  return store;
}

/** The level's `load` step: fetch and decode everything, then install it. */
export async function loadAssets(api: LoadApi): Promise<void> {
  store = await buildStore(api.assets);
}

/** Install a store directly, which is how a test poses one. */
export function setAssets(next: AssetStore): void {
  store = next;
}
