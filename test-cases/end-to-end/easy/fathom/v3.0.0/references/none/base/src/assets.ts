// Fathom — the seven sprite sheets the project ships.
//
// `specs/assets.md` fixes what each folder under `assets/` holds and how many
// frames it has; this module names them once, loads them through the runtime's
// image loader (`src/images.ts`), and hands the renderer one object with a
// field per sheet.
//
// The frame LAYOUTS live here too — which frame of a sheet is which facing, and
// which range is which beat — because they are facts about the supplied art
// rather than figures the specification fixes over the simulation.

import type { Dir } from "./types";
import { loadSheet, type Sheet } from "./images";

export type { Sheet };

/** The folder each sheet is loaded from, and how many frames it must carry. */
const SHEETS = {
  glimmerfin: 8,
  lanternjaw: 16,
  gloamfin: 8,
  flarefish: 8,
  drifter: 8,
  "trench-walls": 19,
  "flare-bloom": 8,
} as const;

/** The decoded art, one field per sheet. */
export interface Assets {
  /** The forager: a two-frame chomp pair per facing. */
  forager: Sheet;
  /** The Lanternjaw: 0-7 its true body, 8-15 the jellyfish disguise. */
  lanternjaw: Sheet;
  /** The Gloamfin: a two-frame pair per facing. */
  gloamfin: Sheet;
  /** The Flarefish: a two-frame pair per facing. */
  flarefish: Sheet;
  /** The bonus drifter: one eight-frame sway loop. */
  drifter: Sheet;
  /** The maze tiles: a 16-frame wall autotile, the floor, the fog, the gate. */
  trench: Sheet;
  /** The flare bloom: charge, bloom and fade, at 128 x 128. */
  flareBloom: Sheet;
}

/**
 * The first frame of the two-frame pair a per-facing sheet draws a body with.
 * Every such sheet lays its facings out in the same order: down, up, left,
 * right.
 */
export function facingBase(facing: Dir): number {
  switch (facing) {
    case "down":
      return 0;
    case "up":
      return 2;
    case "left":
      return 4;
    case "right":
      return 6;
  }
}

/** Where the Lanternjaw's jellyfish disguise begins in its sixteen frames. */
export const LANTERNJAW_DISGUISE = 8;

/** The frames of `assets/trench-walls/` that are not part of the autotile. */
export const TRENCH_FLOOR = 16;
export const TRENCH_FOG = 17;
export const TRENCH_GATE = 18;

/** The three beats of `assets/flare-bloom/`, as first frame and frame count. */
export const BLOOM_BEATS = {
  charge: { from: 0, count: 3 },
  bloom: { from: 3, count: 3 },
  fade: { from: 6, count: 2 },
} as const;

/**
 * Load every sheet, in parallel.
 *
 * A sheet that comes back with the wrong number of frames is an error: the
 * renderer indexes these by the layouts above, and a short sheet would fail one
 * frame at a time, somewhere far from the cause.
 */
export async function loadAssets(): Promise<Assets> {
  const folders = Object.keys(SHEETS) as (keyof typeof SHEETS)[];
  const loaded = await Promise.all(folders.map((folder) => loadSheet(folder)));
  for (let i = 0; i < folders.length; i += 1) {
    const expected = SHEETS[folders[i]];
    if (loaded[i].length !== expected) {
      throw new Error(
        `Fathom: the sheet "${folders[i]}" has ${loaded[i].length} frames, expected ${expected}`,
      );
    }
  }
  const [
    forager,
    lanternjaw,
    gloamfin,
    flarefish,
    drifter,
    trench,
    flareBloom,
  ] = loaded;
  return {
    forager,
    lanternjaw,
    gloamfin,
    flarefish,
    drifter,
    trench,
    flareBloom,
  };
}
