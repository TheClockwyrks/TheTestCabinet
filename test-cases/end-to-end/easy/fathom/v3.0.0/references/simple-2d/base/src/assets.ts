// Fathom — the seeded art (`specs/assets.md`).
//
// Seven sheets sit under `assets/`, each a folder of one PNG per frame named by
// its index. They are read through the ENGINE's asset loader, which resolves
// every path under the fixed `assets/` root and against the page the build is
// served from, so the produced site works at the server root and under a
// sub-path alike. Nothing here builds a URL of its own.
//
// A frame that could not be loaded is kept as `null` rather than failing the
// whole build. The trench is drawn from its art where the art is there and from
// shapes drawn in code where it is not, so the game still runs, still plays and
// still reports its state in a host that cannot decode an image at all.

import type { InitApi } from "@clockwyrks/simple-2d";

/** One sheet's frames, in index order. A frame that failed to load is `null`. */
export type Frames = readonly (ImageBitmap | null)[];

/** Every sheet the game draws from (`specs/assets.md`). */
export interface Sheets {
  /** The forager: a two-frame chomp pair per facing. */
  readonly glimmerfin: Frames;
  /** The Lanternjaw: 0-7 its true body, 8-15 the jellyfish disguise. */
  readonly lanternjaw: Frames;
  readonly gloamfin: Frames;
  readonly flarefish: Frames;
  /** The bonus drifter: one eight-frame sway loop. */
  readonly drifter: Frames;
  /** The flare bloom: charge, bloom, fade, at 128 x 128. */
  readonly flareBloom: Frames;
  /** The maze tiles: the sixteen-frame wall autotile, floor, fog, gate. */
  readonly trench: Frames;
}

/** The folder each sheet lives in, and how many frames it holds. */
const SHEETS = {
  glimmerfin: { folder: "glimmerfin", frames: 8 },
  lanternjaw: { folder: "lanternjaw", frames: 16 },
  gloamfin: { folder: "gloamfin", frames: 8 },
  flarefish: { folder: "flarefish", frames: 8 },
  drifter: { folder: "drifter", frames: 8 },
  flareBloom: { folder: "flare-bloom", frames: 8 },
  trench: { folder: "trench-walls", frames: 19 },
} as const satisfies Record<
  keyof Sheets,
  { readonly folder: string; readonly frames: number }
>;

/** The corridor floor, the unrevealed ground, and the den gate. */
export const TRENCH_FLOOR = 16;
export const TRENCH_FOG = 17;
export const TRENCH_GATE = 18;

/** The frame the flare bloom is widest and brightest on. */
export const BLOOM_PEAK = 5;

type Loader = Pick<InitApi<never>["assets"], "loadImage">;

function loadSheet(
  assets: Loader,
  folder: string,
  count: number,
): Promise<Frames> {
  const frames: Promise<ImageBitmap | null>[] = [];
  for (let i = 0; i < count; i++) {
    frames.push(assets.loadImage(`${folder}/${i}.png`).catch(() => null));
  }
  return Promise.all(frames);
}

/** Every frame of every sheet, loaded once, before the first frame is drawn. */
export async function loadSheets(assets: Loader): Promise<Sheets> {
  const names = Object.keys(SHEETS) as (keyof Sheets)[];
  const loaded = await Promise.all(
    names.map((name) =>
      loadSheet(assets, SHEETS[name].folder, SHEETS[name].frames),
    ),
  );
  const sheets: Partial<Record<keyof Sheets, Frames>> = {};
  names.forEach((name, index) => {
    sheets[name] = loaded[index];
  });
  return sheets as Sheets;
}
