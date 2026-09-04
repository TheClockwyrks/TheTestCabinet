// Coil — the items each menu-bearing screen holds (specs/ui.md).
//
// One source of truth for both halves: the router moves the highlight and accepts
// an item by its index here, and the renderer lays the same list out. The `playing`
// screen carries no menu, so its list is empty and its highlight rests at 0.

import { HOWTO_ITEM, HOWTO_ITEMS, OVER_ITEMS, PAUSE_ITEMS } from "./constants";
import { MODE_ITEM } from "./mode";
import type { Screen } from "./game";

/** The title menu: the mode's entry, then how to play. */
export const TITLE_ITEMS: readonly string[] = [MODE_ITEM, HOWTO_ITEM];

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
