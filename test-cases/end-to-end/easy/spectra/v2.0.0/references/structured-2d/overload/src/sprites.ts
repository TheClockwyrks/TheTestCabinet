// Spectra — the seeded art, loaded through the engine's asset loader
// (specs/assets.md).
//
// Four `SPRITE_SIZE` PNGs and one particle system sit flat under `assets/`, and
// the engine resolves every path under that one root relative to the page the
// build is served from. The level's `load` reaches for all five, once, and holds
// them here: they are immutable art rather than game state, and the engine awaits
// a level's `load` before any actor of that level exists, so a drawing component
// reads its bitmap as a plain value.
//
// A file that did not arrive is held as `null` rather than failing the build. The
// engine reports a host with no image decoding by name, and a game that let that
// rejection escape the load would run no frame at all; `src/render.ts` draws every
// element from its sprite where the sprite arrived and from shapes in code where
// it did not, so the game still plays. The drone-burst falls back to the small
// system below for the same reason: a pop is an outcome the rules produce, and it
// should not depend on a fetch.

import type { ParticleSystem } from "@test-cabinet/particle-runtime";
import type { InitApi } from "@test-cabinet/structured-2d";
import { BURST_FIELD, BURST_SYSTEM, SPRITES } from "./constants";

/** One seeded sprite, or `null` where it did not arrive. */
export type Sprite = ImageBitmap | null;

/** The four seeded silhouettes, by the name each is drawn for. */
export interface Art {
  readonly fighter: Sprite;
  readonly shard: Sprite;
  readonly flux: Sprite;
  readonly prism: Sprite;
}

/**
 * The stand-in the burst falls back to when `drone-burst.json` did not arrive: a
 * single one-shot ring over the same field and the same span, so a pop still
 * plays. The seeded system is what plays whenever it is there.
 */
const FALLBACK_BURST: ParticleSystem = {
  dimensions: 2,
  field: { width: BURST_FIELD, height: BURST_FIELD },
  durationMs: 700,
  fps: 60,
  loop: false,
  emitters: [
    {
      name: "ring",
      shape: "point",
      position: [BURST_FIELD / 2, BURST_FIELD / 2, 0],
      extent: { radius: 1, size: [1, 1, 0] },
      emission: { mode: "burst", count: 60, atMs: 0 },
      lifetimeMs: 320,
      lifetimeSpread: 60,
      speed: 340,
      speedSpread: 80,
      direction: [0, 1, 0],
      coneAngle: 360,
      forces: { drag: 3 },
      particle: {
        sizeCurve: { interp: "ease-out", from: 8, to: 1 },
        opacityCurve: { interp: "ease-out", from: 1, to: 0 },
        colorGradient: [
          { color: "#ffffff", at: 0 },
          { color: "#34e2ff", at: 1 },
        ],
      },
    },
  ],
};

function empty(): Art {
  return { fighter: null, shard: null, flux: null, prism: null };
}

let held: Art = empty();
let burst: ParticleSystem | null = null;

/** The sprites the load produced, ready to draw. */
export function art(): Art {
  return held;
}

/** The particle system a destroyed drone pops with. */
export function burstSystem(): ParticleSystem {
  return burst ?? FALLBACK_BURST;
}

/** Whether the seeded burst system is the one being played. */
export function burstSystemLoaded(): boolean {
  return burst !== null;
}

/**
 * Load every seeded file, writing each path relative to the asset root. A file
 * the host cannot fetch or decode is held as `null`.
 */
export async function loadArt(assets: InitApi["assets"]): Promise<void> {
  const [fighter, shard, flux, prism, system] = await Promise.all([
    assets.loadImage(SPRITES.fighter).catch(() => null),
    assets.loadImage(SPRITES.shard).catch(() => null),
    assets.loadImage(SPRITES.flux).catch(() => null),
    assets.loadImage(SPRITES.prism).catch(() => null),
    assets
      .load(BURST_SYSTEM)
      .then(async (blob) => JSON.parse(await blob.text()) as ParticleSystem)
      .catch(() => null),
  ]);
  held = { fighter, shard, flux, prism };
  burst = system;
}

/** Drop everything the load produced. The build's own tests use this. */
export function resetArt(): void {
  held = empty();
  burst = null;
}
