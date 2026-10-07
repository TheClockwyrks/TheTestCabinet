// Spectra — the seeded art (`specs/assets.md`).
//
// Four PNGs and one particle system sit flat under `assets/`. They are read
// through the ENGINE's asset loader, which resolves every path under the fixed
// `assets/` root and against the page the build is served from, so the produced
// site works at a server root and under a sub-path alike. Nothing here builds a
// URL of its own.
//
// A file that could not be loaded is kept as `null` rather than failing the whole
// build. The field is drawn from the art where the art is there and from shapes
// drawn in code where it is not, so the game still runs, still plays and still
// reports its state in a host that cannot decode an image at all.

import { BURST_SYSTEM, SPRITES } from "./constants";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import type { InitApi } from "@clockwyrks/simple-2d";

/** The four seeded silhouettes, by the name each is drawn for. */
export type SpriteName = keyof typeof SPRITES;

/** Every seeded file the build draws from. */
export interface Art {
  /** One still per element. A sprite that failed to load is `null`. */
  readonly sprites: Readonly<Record<SpriteName, ImageBitmap | null>>;
  /** The system a destroyed drone pops with, or `null` where it did not load. */
  readonly burst: ParticleSystem | null;
}

type Loader = Pick<InitApi<never>["assets"], "loadImage" | "load">;

/** The names in the order `specs/assets.md` lists them. */
const SPRITE_NAMES = Object.keys(SPRITES) as SpriteName[];

/** Every sprite and the burst system, loaded once, before the first frame. */
export async function loadArt(assets: Loader): Promise<Art> {
  const [bitmaps, burst] = await Promise.all([
    Promise.all(
      SPRITE_NAMES.map((name) =>
        assets.loadImage(SPRITES[name]).catch(() => null),
      ),
    ),
    loadBurstSystem(assets),
  ]);

  const sprites: Partial<Record<SpriteName, ImageBitmap | null>> = {};
  SPRITE_NAMES.forEach((name, index) => {
    sprites[name] = bitmaps[index] ?? null;
  });
  return { sprites: sprites as Record<SpriteName, ImageBitmap | null>, burst };
}

/** The authored particle system, parsed from the seeded JSON. */
async function loadBurstSystem(assets: Loader): Promise<ParticleSystem | null> {
  try {
    const blob = await assets.load(BURST_SYSTEM);
    return JSON.parse(await blob.text()) as ParticleSystem;
  } catch {
    return null;
  }
}

/** An art set with nothing loaded, which is what a host with no decoder gets. */
export function emptyArt(): Art {
  const sprites: Partial<Record<SpriteName, ImageBitmap | null>> = {};
  for (const name of SPRITE_NAMES) sprites[name] = null;
  return {
    sprites: sprites as Record<SpriteName, ImageBitmap | null>,
    burst: null,
  };
}
