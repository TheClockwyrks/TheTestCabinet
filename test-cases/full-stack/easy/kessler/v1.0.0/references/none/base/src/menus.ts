// Kessler — where the two menus sit, and which entry a stage point is over
// (specs/screens.md, specs/controls.md).
//
// `specs/screens.md` fixes no layout for a menu, so the placement below is
// this build's own. It is declared here rather than inside the drawing code
// because three readers need the same answer: `src/screens.ts` draws each
// entry into its region, the pointer and touch handling in `src/game.ts`
// decides which entry a contact is over, and `menuItemRect` reports the
// region to whoever asks what the build drew.

import {
  PAUSE_MENU,
  STAGE_SIZE,
  TITLE_MENU,
  type ScreenName,
} from "./constants";

/** One entry's rectangular hit region, in the stage's logical units. */
export interface MenuItemRect {
  /** The region's left edge. */
  x: number;
  /** The region's top edge. */
  y: number;
  width: number;
  height: number;
}

/** How wide an entry's region is. */
const ENTRY_WIDTH = 360;
/** How tall an entry's region is, comfortably clear of the next one. */
const ENTRY_HEIGHT = 44;
/** The distance between one entry's top edge and the next one's. */
const ENTRY_PITCH = 56;
/** Where an entry's text baseline sits inside its region. */
const BASELINE_INSET = 30;

/** The top edge of the title menu's first entry. */
const TITLE_MENU_TOP = 530;
/** The top edge of the pause menu's first entry. */
const PAUSE_MENU_TOP = 464;

/** The title entry that leads to `howto`, which returning from it highlights. */
export const TITLE_HOWTO_ENTRY = 1;

interface MenuLayout {
  readonly entries: readonly string[];
  readonly top: number;
}

/** The two menu-bearing screens, and nothing else (`specs/screens.md`). */
const MENUS: Partial<Record<ScreenName, MenuLayout>> = {
  title: { entries: TITLE_MENU, top: TITLE_MENU_TOP },
  paused: { entries: PAUSE_MENU, top: PAUSE_MENU_TOP },
};

/** The entries `screen`'s menu shows, or `null` on a screen with no menu. */
export function menuEntries(screen: ScreenName): readonly string[] | null {
  return MENUS[screen]?.entries ?? null;
}

/** Every region `screen`'s menu occupies, or `null` on a screen with no menu. */
export function menuItemRects(screen: ScreenName): MenuItemRect[] | null {
  const menu = MENUS[screen];
  if (menu === undefined) return null;
  return menu.entries.map((_entry, index) => ({
    x: (STAGE_SIZE - ENTRY_WIDTH) / 2,
    y: menu.top + index * ENTRY_PITCH,
    width: ENTRY_WIDTH,
    height: ENTRY_HEIGHT,
  }));
}

/**
 * The region of entry `index` on `screen`'s menu, or `null` on a screen with
 * no menu and for an `index` outside its entries.
 */
export function menuItemRect(
  screen: ScreenName,
  index: number,
): MenuItemRect | null {
  const rects = menuItemRects(screen);
  if (rects === null) return null;
  if (!Number.isInteger(index) || index < 0 || index >= rects.length) {
    return null;
  }
  return rects[index];
}

/** The text baseline an entry drawn into `rect` sits on. */
export function entryBaseline(rect: MenuItemRect): number {
  return rect.y + BASELINE_INSET;
}

/** The entry the stage point `(x, y)` is over, or `null` over none of them. */
export function menuEntryAt(
  screen: ScreenName,
  x: number,
  y: number,
): number | null {
  const rects = menuItemRects(screen);
  if (rects === null) return null;
  const index = rects.findIndex(
    (rect) =>
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height,
  );
  return index === -1 ? null : index;
}
