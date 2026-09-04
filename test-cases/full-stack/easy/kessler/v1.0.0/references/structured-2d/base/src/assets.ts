// Kessler — loading the produced art (specs/assets.md, ASSET-LAYOUT.md).
//
// Every sprite and particle system the game shows was produced with the asset
// tools during this build and committed under `assets/`; nothing here invokes
// a tool. The engine's asset loader resolves every path under its `assets/`
// root, relative to the page the build is served from, so the built site runs
// from the root of a static host and from a sub-path alike. A load that fails
// leaves the game running: each image resolves to `null`, the render
// components fall back to code-drawn stand-ins, and a missing particle system
// simply spawns nothing, so a missing file costs polish rather than
// playability.
//
// The loaded set is held here, in the module the render components import, as
// the engine's asset documentation recommends: the instance's `initialize`
// awaits `loadAssets` before the start level opens, so an actor constructed
// for that level reads each image as a plain value.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import {
  BALL_SPIN_FRAMES,
  PARTICLE_PATHS,
  POD_KINDS,
  SPRITE_PATHS,
  type PodKind,
} from "./constants";
import type { ParticleSystemName } from "./sim";
import type { InitApi } from "@test-cabinet/structured-2d";

/** Everything the build loads from the produced files. */
export interface KesslerAssets {
  /** The planet sprite, or `null` for one that failed to load. */
  planet: ImageBitmap | null;
  /** One sprite per pod kind. */
  pods: Record<PodKind, ImageBitmap | null>;
  /** The ball's six spin frames, `0` through `5`. */
  ball: (ImageBitmap | null)[];
  /** The three produced particle systems, parsed. */
  systems: Partial<Record<ParticleSystemName, ParticleSystem>>;
}

/** The empty set: every image missing, so every fallback draws. */
function emptyAssets(): KesslerAssets {
  return {
    planet: null,
    pods: {
      widen: null,
      narrow: null,
      multiball: null,
      shield: null,
      pierce: null,
    },
    ball: Array.from({ length: BALL_SPIN_FRAMES }, () => null),
    systems: {},
  };
}

let loaded: KesslerAssets = emptyAssets();

/** The loaded set. Empty until `loadAssets` resolves. */
export function kesslerAssets(): KesslerAssets {
  return loaded;
}

/** An image by its path, or `null` where it will not load or decode. */
function imageOf(
  api: Pick<InitApi, "assets">,
  path: string,
): Promise<ImageBitmap | null> {
  return api.assets.loadImage(path).catch(() => null);
}

/** A parsed particle system by its path, or `null`. */
function systemOf(
  api: Pick<InitApi, "assets">,
  path: string,
): Promise<ParticleSystem | null> {
  return api.assets
    .load(path)
    .then(async (blob) => JSON.parse(await blob.text()) as ParticleSystem)
    .catch(() => null);
}

/**
 * Load every produced file the game draws, tolerating each failure on its
 * own, and install the result for the render components to read.
 */
export async function loadAssets(api: Pick<InitApi, "assets">): Promise<void> {
  const set = emptyAssets();
  const jobs: Promise<void>[] = [];

  jobs.push(
    imageOf(api, SPRITE_PATHS.planet).then((image) => {
      set.planet = image;
    }),
  );
  for (const kind of POD_KINDS) {
    jobs.push(
      imageOf(api, SPRITE_PATHS.pods[kind]).then((image) => {
        set.pods[kind] = image;
      }),
    );
  }
  SPRITE_PATHS.ball.forEach((path, frame) => {
    jobs.push(
      imageOf(api, path).then((image) => {
        set.ball[frame] = image;
      }),
    );
  });
  for (const name of Object.keys(PARTICLE_PATHS) as ParticleSystemName[]) {
    jobs.push(
      systemOf(api, PARTICLE_PATHS[name]).then((system) => {
        if (system !== null) set.systems[name] = system;
      }),
    );
  }

  await Promise.all(jobs);
  loaded = set;
}
