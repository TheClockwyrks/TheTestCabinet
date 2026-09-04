// Deepcore — what each menu screen lists, and what choosing an item does
// (specs/ui.md).
//
// The list lives here rather than in the drawing because the game owns the
// highlighted index and has to know how long the current screen's menu is. The
// renderer draws these items, the pointer hit-tests them, and `src/flow.ts` runs
// the action choosing one names.

import {
  GAME_OVER_ITEMS,
  GAME_OVER_SAVE_ITEMS,
  MODE_ITEMS,
  PAUSE_ITEMS,
  SIZE_ITEMS,
  TITLE_ITEMS,
  VICTORY_ITEMS,
} from "./constants";
import type { Mode, ScreenName } from "./constants";

/** One menu item: what it reads, and the action choosing it runs. */
export interface MenuItem {
  readonly label: string;
  readonly action: string;
}

/** What a screen's menu lists, given whether a save exists and the mode. */
export function menuFor(
  screen: ScreenName,
  mode: Mode,
  saved: boolean,
): readonly MenuItem[] {
  switch (screen) {
    case "title": {
      const items: MenuItem[] = [];
      // CONTINUE is present only while a save exists, and it leads when it is.
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
      // A Standard death keeps the save, so it can be restored; Hardcore
      // consumed it.
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

/** The menu the game currently shows, read off its screen, mode, and save slot. */
export function menuItems(state: {
  readonly screen: ScreenName;
  readonly mode: Mode;
  readonly hasSave: boolean;
}): readonly MenuItem[] {
  return menuFor(state.screen, state.mode, state.hasSave);
}
