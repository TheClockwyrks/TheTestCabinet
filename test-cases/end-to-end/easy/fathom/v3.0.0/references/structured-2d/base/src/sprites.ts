// Fathom — the seeded art, loaded through the engine's asset loader.
//
// `specs/assets.md` fixes seven sheets under `assets/`, one PNG per frame named
// by its frame index, and the engine resolves every path under that one root
// relative to the page the build is served from. The game instance's
// `initialize` loads them all, once, and holds the decoded frames here: they are
// immutable art rather than game state, they outlive every world, and the engine
// documents this as where a loaded asset is kept.
//
// A frame that did not arrive is held as `null` rather than failing the build.
// The engine reports a host with no image decoding by name, and a game that let
// that rejection escape `initialize` would run no frame at all; `src/render.ts`
// draws every element from its sheet where the sheet arrived and from shapes in
// code where it did not, so the game still plays.

import type { InitApi } from "@test-cabinet/structured-2d";

/** One frame of a sheet, or `null` where it did not arrive. */
export type Frame = ImageBitmap | null;

/** The seven sheets, each a dense array indexed by frame number. */
export interface Sheets {
  readonly glimmerfin: readonly Frame[];
  readonly lanternjaw: readonly Frame[];
  readonly gloamfin: readonly Frame[];
  readonly flarefish: readonly Frame[];
  readonly drifter: readonly Frame[];
  readonly flareBloom: readonly Frame[];
  readonly trench: readonly Frame[];
}

/** Each sheet's folder under the asset root and how many frames it holds. */
const SHEETS = {
  glimmerfin: { folder: "glimmerfin", frames: 8 },
  lanternjaw: { folder: "lanternjaw", frames: 16 },
  gloamfin: { folder: "gloamfin", frames: 8 },
  flarefish: { folder: "flarefish", frames: 8 },
  drifter: { folder: "drifter", frames: 8 },
  flareBloom: { folder: "flare-bloom", frames: 8 },
  trench: { folder: "trench-walls", frames: 19 },
} as const satisfies Record<keyof Sheets, { folder: string; frames: number }>;

/** The maze tileset's three named frames beyond the sixteen-frame autotile. */
export const TRENCH_FLOOR = 16;
export const TRENCH_FOG = 17;
export const TRENCH_GATE = 18;

function empty(): Sheets {
  const blank = (count: number): Frame[] => new Array<Frame>(count).fill(null);
  return {
    glimmerfin: blank(SHEETS.glimmerfin.frames),
    lanternjaw: blank(SHEETS.lanternjaw.frames),
    gloamfin: blank(SHEETS.gloamfin.frames),
    flarefish: blank(SHEETS.flarefish.frames),
    drifter: blank(SHEETS.drifter.frames),
    flareBloom: blank(SHEETS.flareBloom.frames),
    trench: blank(SHEETS.trench.frames),
  };
}

let held: Sheets = empty();

/** The frames the load produced, ready to draw. */
export function sheets(): Sheets {
  return held;
}

async function loadSheet(
  assets: InitApi["assets"],
  folder: string,
  frames: number,
): Promise<Frame[]> {
  return Promise.all(
    Array.from({ length: frames }, (_unused, index) =>
      assets.loadImage(`${folder}/${index}.png`).catch(() => null),
    ),
  );
}

/**
 * Load every frame of every sheet, writing each path relative to the asset
 * root. A frame the host cannot fetch or decode is held as `null`.
 */
export async function loadSheets(assets: InitApi["assets"]): Promise<void> {
  const names = Object.keys(SHEETS) as (keyof Sheets)[];
  const loaded = await Promise.all(
    names.map((name) =>
      loadSheet(assets, SHEETS[name].folder, SHEETS[name].frames),
    ),
  );
  const next = empty() as Record<keyof Sheets, Frame[]>;
  names.forEach((name, index) => {
    next[name] = loaded[index];
  });
  held = next;
}
