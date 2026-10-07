// Floe — where each menu sits, and the region each of its items is picked from.
//
// `specs/ui.md` fixes the items each screen carries and the order they are shown
// in, and leaves the arrangement to the build. That makes the layout one thing
// rather than two: `src/render.ts` draws each item at the baseline this file
// gives it, and `menuItemRect` in `specs/instrumentation.md` reports the region
// around that same baseline, so a pointer aimed at the reported region lands on
// the item a player sees there.
//
// A REGION IS SHORTER THAN THE STEP BETWEEN TWO ITEMS, so no two regions of one
// menu overlap and a point between two entries picks neither. It sits mostly
// above the baseline, because that is where an alphabetic baseline puts the
// glyphs.

import { ENDING_ITEMS, PAUSE_ITEMS, STAGE_W, TITLE_ITEMS } from "./constants";
import type { Screen } from "./game";

/** One item's hit region, in logical units: top-left corner plus size. */
export interface MenuRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How one screen's menu is arranged down the stage. */
export interface MenuLayout {
  /** The entries, in the order `specs/ui.md` states them. */
  readonly items: readonly string[];
  /** The first entry's text baseline. */
  readonly top: number;
  /** Baseline to baseline. */
  readonly step: number;
  /** How wide each entry's region is, centred on the stage. */
  readonly width: number;
}

/** Baseline to baseline, the same for every menu this build draws. */
const STEP = 44;

/** How far a region reaches above its item's baseline. */
const ABOVE_BASELINE = 28;

/** How tall a region is; shorter than {@link STEP}, so no two overlap. */
const ITEM_HEIGHT = 36;

/** Every screen that carries a menu, and how that menu is arranged. */
const LAYOUTS: Partial<Record<Screen, MenuLayout>> = {
  title: { items: TITLE_ITEMS, top: 440, step: STEP, width: 460 },
  paused: { items: PAUSE_ITEMS, top: 350, step: STEP, width: 420 },
  victory: { items: ENDING_ITEMS, top: 450, step: STEP, width: 460 },
  gameover: { items: ENDING_ITEMS, top: 450, step: STEP, width: 460 },
};

/** How the screen's menu is arranged, or `null` where it carries none. */
export function menuLayout(screen: Screen): MenuLayout | null {
  return LAYOUTS[screen] ?? null;
}

/** The baseline `layout`'s `index`th entry is drawn at. */
export function menuBaseline(layout: MenuLayout, index: number): number {
  return layout.top + index * layout.step;
}

/**
 * The region item `index` of the screen's menu is picked from, or `null` where
 * the screen shows no menu or the index names no entry.
 *
 * What `specs/instrumentation.md`'s `menuItemRect(index)` answers.
 */
export function menuItemRect(screen: Screen, index: number): MenuRect | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= layout.items.length) {
    return null;
  }
  return {
    x: (STAGE_W - layout.width) / 2,
    y: menuBaseline(layout, index) - ABOVE_BASELINE,
    w: layout.width,
    h: ITEM_HEIGHT,
  };
}

/** Which entry of the screen's menu a stage point falls in, or `null`. */
export function menuItemAt(
  screen: Screen,
  x: number,
  y: number,
): number | null {
  const layout = menuLayout(screen);
  if (layout === null) return null;
  for (let index = 0; index < layout.items.length; index += 1) {
    const rect = menuItemRect(screen, index);
    if (rect === null) continue;
    if (
      x >= rect.x &&
      x < rect.x + rect.w &&
      y >= rect.y &&
      y < rect.y + rect.h
    ) {
      return index;
    }
  }
  return null;
}
