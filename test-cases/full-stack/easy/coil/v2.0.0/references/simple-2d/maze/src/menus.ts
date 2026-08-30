// Coil — the items each menu-bearing screen holds (specs/ui.md).
//
// One source of truth for both halves: the router moves the highlight and accepts
// an item by its index here, and the renderer lays the same list out. The `playing`
// screen carries no menu, so its list is empty and its highlight rests at 0.
//
// `src/constants.ts` fixes the three menus whose copy the specification names. The
// how-to-play screen's one item is not among them, because `specs/ui.md` fixes
// only that `back` returns to the title from there, so its wording is this build's.

import { OVER_ITEMS, PAUSE_ITEMS, TITLE_ITEMS, type Screen } from "./constants";

/** The one item the how-to-play screen's menu holds. */
export const HOWTO_ITEMS: readonly string[] = ["BACK"];

/** The items `screen` holds, in the order they are drawn. */
export function menuItems(screen: Screen): readonly string[] {
  switch (screen) {
    case "title":
      return TITLE_ITEMS;
    case "howto":
      return HOWTO_ITEMS;
    case "paused":
      return PAUSE_ITEMS;
    case "gameover":
    case "cleared":
      return OVER_ITEMS;
    case "playing":
      return [];
  }
}
