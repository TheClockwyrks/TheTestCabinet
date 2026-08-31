// Kessler — loading the produced assets (specs/assets.md, ASSET-LAYOUT.md).
//
// Every sprite and particle system the game shows was produced with the asset
// tools during this build and committed under `assets/`; nothing here invokes
// a tool. Every path is asked of the ENGINE'S asset loader, from
// `src/constants.ts`, relative to the one root it resolves under, so the
// build constructs no URL of its own and the same game loads from a served
// page, from a build output, and from a test process. A load that fails
// leaves the game running: the sprite is simply `null` and the renderer
// falls back to a code-drawn stand-in, so a missing file costs the game its
// polish rather than its playability. The produced sounds load through the
// engine's cue bus in `src/audio.ts`.

import type { ParticleSystem as SystemSpec } from "@test-cabinet/particle-runtime";
import type { InitApi } from "@test-cabinet/simple-2d";
import {
  PARTICLE_PATHS,
  POD_KINDS,
  SPRITE_PATHS,
  type PodKind,
} from "./constants";
import type { ParticleSystem } from "./figures";

/** The produced sprite set, `null` wherever a file did not arrive. */
export interface KesslerAssets {
  /** The planet sprite, drawn centered on the stage center. */
  readonly planet: ImageBitmap | null;
  /** One sprite per pod kind. */
  readonly pods: Readonly<Record<PodKind, ImageBitmap | null>>;
  /** The ball's six spin frames, `0` through `5`. */
  readonly ball: readonly (ImageBitmap | null)[];
}

/** A sprite set with nothing in it, which is what a failed load leaves. */
export const NO_ASSETS: KesslerAssets = {
  planet: null,
  pods: {
    widen: null,
    narrow: null,
    multiball: null,
    shield: null,
    pierce: null,
  },
  ball: SPRITE_PATHS.ball.map(() => null),
};

function loadOne(
  api: Pick<InitApi, "assets">,
  path: string,
): Promise<ImageBitmap | null> {
  return api.assets.loadImage(path).catch(() => null);
}

/** Load every produced sprite the renderer draws. */
export async function loadSprites(
  api: Pick<InitApi, "assets">,
): Promise<KesslerAssets> {
  const [planet, podImages, ball] = await Promise.all([
    loadOne(api, SPRITE_PATHS.planet),
    Promise.all(POD_KINDS.map((kind) => loadOne(api, SPRITE_PATHS.pods[kind]))),
    Promise.all(SPRITE_PATHS.ball.map((path) => loadOne(api, path))),
  ]);
  const pods = {} as Record<PodKind, ImageBitmap | null>;
  POD_KINDS.forEach((kind, index) => {
    pods[kind] = podImages[index];
  });
  return { planet, pods, ball };
}

/**
 * Load and parse the three produced particle systems. A file that does not
 * arrive or parse simply leaves its system out, and that effect never spawns.
 */
export async function loadSystems(
  api: Pick<InitApi, "assets">,
): Promise<Partial<Record<ParticleSystem, SystemSpec>>> {
  const systems: Partial<Record<ParticleSystem, SystemSpec>> = {};
  await Promise.all(
    (Object.keys(PARTICLE_PATHS) as ParticleSystem[]).map(async (name) => {
      try {
        const blob = await api.assets.load(PARTICLE_PATHS[name]);
        systems[name] = JSON.parse(await blob.text()) as SystemSpec;
      } catch {
        // The system stays out, and the game plays on without the effect.
      }
    }),
  );
  return systems;
}

/** Whether an image actually decoded, so the renderer can fall back. */
export function isReady(image: ImageBitmap | null): image is ImageBitmap {
  return image !== null && image.width > 0;
}
