// Spectra — the seeded art (`specs/assets.md`).
//
// Four PNGs and one particle system sit flat under `assets/`. They are read
// through the ENGINE's asset loader, which resolves every path under the fixed
// `assets/` root and against the page the build is served from, so the produced
// site works at a server root and under a sub-path alike. Nothing here builds a
// URL of its own.
//
// A file that could not be loaded is kept as `null` rather than failing the
// whole build. The field is drawn from the art where the art is there and from
// shapes drawn in code where it is not, so the game still runs, still plays and
// still reports its state in a host that cannot fetch or decode a file at all.

import { BURST_SYSTEM, SPRITES } from "./constants";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { InitApi } from "@clockwyrks/simple-2d";

/** The seeded art, loaded once before the first frame is drawn. */
export interface Art {
  /** The resonator-fighter, cyan with a ring core. */
  readonly fighter: ImageBitmap | null;
  /** The fixed-band crystal, magenta with a diamond. */
  readonly shard: ImageBitmap | null;
  /** The oscillating drone, caught mid-shimmer, carrying both bands. */
  readonly flux: ImageBitmap | null;
  /** The two-band drone: a cyan shell around a magenta core. */
  readonly prism: ImageBitmap | null;
  /** The one-shot drone-burst a destroyed drone pops with. */
  readonly burst: ParticleSystem | null;
}

/** The part of the engine's loader this module uses. */
type Loader = Pick<InitApi<never>["assets"], "loadImage" | "load">;

/** One sprite, or `null` where this host could not produce it. */
function loadSprite(assets: Loader, path: string): Promise<ImageBitmap | null> {
  return assets.loadImage(path).catch(() => null);
}

/**
 * The seeded particle system, as the runtime's own `ParticleSystem`.
 *
 * The loader hands back the file's bytes; the system is the JSON in them. A file
 * that did not arrive, or did not parse, leaves the burst effect absent rather
 * than stopping the game.
 */
async function loadBurstSystem(
  assets: Loader,
  path: string,
): Promise<ParticleSystem | null> {
  try {
    const blob = await assets.load(path);
    return JSON.parse(await blob.text()) as ParticleSystem;
  } catch {
    return null;
  }
}

/** Every seeded file, loaded in parallel, before the first frame is drawn. */
export async function loadArt(assets: Loader): Promise<Art> {
  const [fighter, shard, flux, prism, burst] = await Promise.all([
    loadSprite(assets, SPRITES.fighter),
    loadSprite(assets, SPRITES.shard),
    loadSprite(assets, SPRITES.flux),
    loadSprite(assets, SPRITES.prism),
    loadBurstSystem(assets, BURST_SYSTEM),
  ]);
  return { fighter, shard, flux, prism, burst };
}

/** Art with every file missing, which is what a host with no page gets. */
export function emptyArt(): Art {
  return { fighter: null, shard: null, flux: null, prism: null, burst: null };
}
