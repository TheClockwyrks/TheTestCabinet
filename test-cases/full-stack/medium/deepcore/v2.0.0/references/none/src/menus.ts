// Deepcore — what each menu screen lists, and what choosing an item does
// (specs/ui.md).
//
// The list lives here rather than in the renderer because the game owns the
// highlighted index and has to know how long the current screen's menu is. The
// renderer draws these items and the controller runs their actions.

import {
  GAME_OVER_ITEMS,
  GAME_OVER_SAVE_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  SIZE_ITEMS,
  TITLE_ITEMS,
  VICTORY_ITEMS,
} from "./constants";
import { hasSave } from "./save";
import type { Screen } from "./types";

/** One menu item: what it reads, and the action choosing it runs. */
export interface MenuItem {
  label: string;
  action: string;
}

/** What the given screen's menu lists, given whether a save exists and the mode. */
export function menuFor(
  screen: Screen,
  mode: "standard" | "hardcore",
  saved: boolean,
): MenuItem[] {
  switch (screen) {
    case "title": {
      const items: MenuItem[] = [];
      if (saved) items.push({ label: TITLE_ITEMS[0], action: "continue" });
      items.push({ label: TITLE_ITEMS[1], action: "nav:mode-select" });
      items.push({ label: TITLE_ITEMS[2], action: "nav:how-to-play" });
      return items;
    }
    case "mode-select":
      return [
        { label: MODE_ITEMS[0], action: "mode:standard" },
        { label: MODE_ITEMS[1], action: "mode:hardcore" },
        { label: MODE_ITEMS[2], action: "nav:title" },
      ];
    case "size-select":
      return [
        { label: SIZE_ITEMS[0], action: "size:quick" },
        { label: SIZE_ITEMS[1], action: "size:standard" },
        { label: SIZE_ITEMS[2], action: "size:marathon" },
        { label: SIZE_ITEMS[3], action: "nav:mode-select" },
      ];
    case "how-to-play":
      return [{ label: "BACK", action: "nav:title" }];
    case "paused":
      return [
        { label: PAUSE_ITEMS[0], action: "resume" },
        { label: PAUSE_ITEMS[1], action: "restart" },
        { label: PAUSE_ITEMS[2], action: "nav:title" },
      ];
    case "victory":
      return [
        { label: VICTORY_ITEMS[0], action: "again" },
        { label: VICTORY_ITEMS[1], action: "nav:title" },
      ];
    case "game-over":
      // A Standard death keeps the save, so it can be restored; Hardcore consumed it.
      if (mode === "standard" && saved) {
        return [
          { label: GAME_OVER_SAVE_ITEMS[0], action: "continue" },
          { label: GAME_OVER_SAVE_ITEMS[1], action: "nav:title" },
        ];
      }
      return [
        { label: GAME_OVER_ITEMS[0], action: "again" },
        { label: GAME_OVER_ITEMS[1], action: "nav:title" },
      ];
    default:
      return [];
  }
}

/**
 * The entry a menu highlights on arrival (specs/ui.md, "Returning to a menu").
 *
 * Arriving at a menu by going back selects the entry that led away from it, so
 * the entries are named rather than numbered: `CONTINUE` is on the title only
 * while a save exists and shifts the ones below it when it is. Every other
 * arrival highlights the menu's first item.
 */
export function arrivalIndex(
  from: Screen,
  to: Screen,
  mode: "standard" | "hardcore",
  saved: boolean,
): number {
  const items = menuFor(to, mode, saved);
  const at = (label: string): number => {
    const index = items.findIndex((item) => item.label === label);
    return index < 0 ? 0 : index;
  };
  if (to === "title") {
    if (from === "how-to-play") return at(TITLE_ITEMS[2]);
    if (
      from === "mode-select" ||
      from === "paused" ||
      from === "victory" ||
      from === "game-over"
    ) {
      return at(TITLE_ITEMS[1]);
    }
  }
  if (to === "mode-select" && from === "size-select") {
    return at(mode === "hardcore" ? MODE_ITEMS[1] : MODE_ITEMS[0]);
  }
  return 0;
}

/** The menu the game currently shows, read off its screen, mode, and save slot. */
export function menuItems(game: {
  screen: Screen;
  mode: "standard" | "hardcore";
}): MenuItem[] {
  return menuFor(game.screen, game.mode, hasSave());
}
