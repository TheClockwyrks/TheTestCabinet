// Deepcore — loading the PRODUCED assets through the engine (specs/assets.md).
//
// Every sprite, animation frame, particle `system.json`, and sound the game
// plays was produced with the six on-`PATH` tools and committed under `assets/`
// at the paths `specs/assets.md` fixes. The engine's loader resolves each path
// under its own asset root, so no URL here is root-absolute and the built site
// runs from any base path.
//
// WHAT IS LOADED IS A MANIFEST, not a directory scan. The build knows exactly
// which files it produced, so the frame counts and the variant counts below are
// stated rather than probed: a scan would either miss a file or ask the loader
// for one that was never made.
//
// EVERY LOAD IS TOLERATED. A file that is missing or will not decode yields
// `null`, and the drawing falls back to code for that one thing, so the
// project type-checks, builds, and runs before the assets land and a single
// broken file never takes the game down. The audio is not here: a cue is loaded
// straight onto the engine's audio bus in `src/audio.ts`.

import {
  BANDS,
  CRACK_FRAMES,
  GEMSTONE_IDS,
  MINER_STATES,
  ORE_IDS,
} from "./constants";
import type { BandName, MinerState, OreId } from "./constants";
import type { FxKind } from "./effects";
import { FX_KINDS } from "./effects";
import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { InitApi } from "@test-cabinet/structured-2d";

/** How many frames each produced miner cycle holds. */
const MINER_FRAMES: Readonly<Record<MinerState, number>> = {
  idle: 3,
  walk: 6,
  "drill-down": 4,
  "drill-side": 4,
  jetpack: 4,
  fall: 3,
  hurt: 3,
  "fuel-out": 3,
};

/** How many interchangeable rock variants each band was produced with. */
const BAND_VARIANTS = 3;

/** How many unbreakable-boulder variants were produced. */
const STONE_VARIANTS = 2;

/** How many frames the lava shimmer runs through. */
const LAVA_FRAMES = 6;

/** The six assembly states of the rocket, from the bare pad to launch-ready. */
const ROCKET_STAGES = 6;

/** The four sprites under `assets/materials/`. */
const MATERIAL_SPRITES = [
  "resonite",
  "cryenite",
  "core",
  "core-sample",
] as const;

/** The nine sprites under `assets/surface/`. */
const SURFACE_SPRITES = [
  "fuel-depot",
  "ore-market",
  "save-pad",
  "upgrade-shop",
  "supply-depot",
  "launch-pad",
  "cave-mouth",
  "ground",
  "sky",
] as const;

/** The status-bar icons under `assets/icons/`. */
const ICON_SPRITES = [
  "fuel",
  "hull",
  "cargo",
  "credits",
  "depth",
  "resonite",
  "cryenite",
] as const;

export type MaterialSprite = (typeof MATERIAL_SPRITES)[number];
export type SurfaceSprite = (typeof SURFACE_SPRITES)[number];
export type IconSprite = (typeof ICON_SPRITES)[number];

/** A produced sprite, or `null` where its file did not arrive. */
export type Sprite = ImageBitmap | null;

/** Every produced sprite and cycle the drawing uses. */
export interface Assets {
  /** One cycle per animation state, in frame order. */
  readonly miner: Readonly<Record<MinerState, readonly Sprite[]>>;
  /** The interchangeable rock variants of each band. */
  readonly bands: Readonly<Record<BandName, readonly Sprite[]>>;
  readonly stone: readonly Sprite[];
  readonly bedrock: Sprite;
  readonly tunnel: Sprite;
  /** The drill-damage overlay, faint hairlines to a shattered face. */
  readonly crack: readonly Sprite[];
  /** The lava shimmer's cycle. */
  readonly lava: readonly Sprite[];
  readonly ore: Readonly<Record<OreId, Sprite>>;
  readonly materials: Readonly<Record<MaterialSprite, Sprite>>;
  readonly surface: Readonly<Record<SurfaceSprite, Sprite>>;
  /** The rocket at `0` through `5` components installed. */
  readonly rocket: readonly Sprite[];
  readonly icons: Readonly<Record<IconSprite, Sprite>>;
}

/** What `initialize` loads: the sprites the state holds, and the systems it plays. */
export interface Loaded {
  readonly assets: Assets;
  readonly systems: Partial<Record<FxKind, ParticleSystem>>;
}

/** An empty asset set, which the drawing falls back to code for throughout. */
export function noAssets(): Assets {
  const miner = {} as Record<MinerState, readonly Sprite[]>;
  for (const state of MINER_STATES) miner[state] = [];
  const bands = {} as Record<BandName, readonly Sprite[]>;
  for (const band of BANDS) bands[band] = [];
  const ore = {} as Record<OreId, Sprite>;
  for (const id of [...ORE_IDS, ...GEMSTONE_IDS]) ore[id] = null;
  const materials = {} as Record<MaterialSprite, Sprite>;
  for (const name of MATERIAL_SPRITES) materials[name] = null;
  const surface = {} as Record<SurfaceSprite, Sprite>;
  for (const name of SURFACE_SPRITES) surface[name] = null;
  const icons = {} as Record<IconSprite, Sprite>;
  for (const name of ICON_SPRITES) icons[name] = null;
  return {
    miner,
    bands,
    stone: [],
    bedrock: null,
    tunnel: null,
    crack: [],
    lava: [],
    ore,
    materials,
    surface,
    rocket: [],
    icons,
  };
}

/** A record built from the pairs a set of loads resolved to. */
function record<K extends string, V>(
  entries: readonly (readonly [K, V])[],
): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const [key, value] of entries) out[key] = value;
  return out;
}

/** The path a numbered frame lands at, `frame00.png` upward. */
function framePath(prefix: string, index: number): string {
  return `${prefix}/frame${index.toString().padStart(2, "0")}.png`;
}

/** Load every produced sprite and particle system, tolerating a missing file. */
export async function loadAssets(
  api: Pick<InitApi, "assets">,
): Promise<Loaded> {
  const image = (path: string): Promise<Sprite> =>
    api.assets.loadImage(path).catch(() => null);

  const frames = (prefix: string, count: number): Promise<Sprite[]> =>
    Promise.all(
      Array.from({ length: count }, (_, index) =>
        image(framePath(prefix, index)),
      ),
    );

  const minerEntries = await Promise.all(
    MINER_STATES.map(
      async (state) =>
        [state, await frames(`miner/${state}`, MINER_FRAMES[state])] as const,
    ),
  );
  const bandEntries = await Promise.all(
    BANDS.map(
      async (band) =>
        [
          band,
          await Promise.all(
            Array.from({ length: BAND_VARIANTS }, (_, index) =>
              image(`tiles/${band}-${index}.png`),
            ),
          ),
        ] as const,
    ),
  );
  const oreEntries = await Promise.all(
    [...ORE_IDS, ...GEMSTONE_IDS].map(
      async (id) => [id, await image(`ore/${id}.png`)] as const,
    ),
  );
  const materialEntries = await Promise.all(
    MATERIAL_SPRITES.map(
      async (name) => [name, await image(`materials/${name}.png`)] as const,
    ),
  );
  const surfaceEntries = await Promise.all(
    SURFACE_SPRITES.map(
      async (name) => [name, await image(`surface/${name}.png`)] as const,
    ),
  );
  const iconEntries = await Promise.all(
    ICON_SPRITES.map(
      async (name) => [name, await image(`icons/${name}.png`)] as const,
    ),
  );

  const [stone, bedrock, tunnel, crack, lava, rocket, systems] =
    await Promise.all([
      Promise.all(
        Array.from({ length: STONE_VARIANTS }, (_, index) =>
          image(`tiles/stone-${index}.png`),
        ),
      ),
      image("tiles/bedrock.png"),
      image("tiles/tunnel.png"),
      frames("tiles/crack", CRACK_FRAMES),
      frames("hazards/lava", LAVA_FRAMES),
      Promise.all(
        Array.from({ length: ROCKET_STAGES }, (_, index) =>
          image(`rocket/stage${index}.png`),
        ),
      ),
      loadSystems(api),
    ]);

  return {
    assets: {
      miner: record(minerEntries),
      bands: record(bandEntries),
      stone,
      bedrock,
      tunnel,
      crack,
      lava,
      ore: record(oreEntries),
      materials: record(materialEntries),
      surface: record(surfaceEntries),
      rocket,
      icons: record(iconEntries),
    },
    systems,
  };
}

/** Load the twelve produced particle systems, tolerating a missing file. */
async function loadSystems(
  api: Pick<InitApi, "assets">,
): Promise<Partial<Record<FxKind, ParticleSystem>>> {
  const systems: Partial<Record<FxKind, ParticleSystem>> = {};
  await Promise.all(
    FX_KINDS.map(async (kind) => {
      try {
        const blob = await api.assets.load(`fx/${kind}.json`);
        systems[kind] = JSON.parse(await blob.text()) as ParticleSystem;
      } catch {
        // The system was not produced yet; the burst is simply skipped.
      }
    }),
  );
  return systems;
}

// ---- What the instance loaded -------------------------------------------

/**
 * The produced sprites, held for the actors and components that draw them.
 *
 * A level's assets are loaded before any of its actors exist, and Deepcore's are
 * the whole game's, so the instance's `initialize` loads them once and installs
 * them here. Nothing reads this before that has happened: the world is built
 * afterwards, and the state takes its copy at construction.
 */
let installed: Assets = noAssets();

/** Hand the build the produced sprites, once, from the instance's `initialize`. */
export function installAssets(loaded: Assets): void {
  installed = loaded;
}

/** The produced sprites as they stand, or the empty set before they arrive. */
export function currentAssets(): Assets {
  return installed;
}

/** The frame a cycle is on at a moment, looping over its length. */
export function cycleFrame(
  cycle: readonly Sprite[],
  seconds: number,
  fps: number,
): Sprite {
  if (cycle.length === 0) return null;
  return cycle[Math.floor(seconds * fps) % cycle.length];
}
