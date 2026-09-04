// Arc Foundry — what each menu screen offers (specs/ui.md).
//
// One list per screen, so the renderer draws exactly what the keyboard walks and the
// pointer activates, and so the surface's `menuButtons` reports exactly the same
// choices in exactly the same order.
//
// A choice is named by the identifier `specs/instrumentation.md` reports it under, so
// there is no second table mapping one vocabulary onto another: what the game routes on
// and what a caller reads back are the same word.

import {
  BACK_ITEM,
  DIFFICULTIES,
  MAPS,
  OVERLOAD_ITEMS,
  PAUSE_ITEMS,
  TITLE_ITEMS,
  VICTORY_ITEMS,
  type MenuAction,
  type ScreenName,
} from "./constants";

/** One choice: what it leads to, and the text it is drawn as. */
export interface MenuItem {
  action: MenuAction;
  label: string;
}

/** The screens that ARE menus. Every other screen reports no choices at all. */
const MENU_SCREENS: ReadonlySet<ScreenName> = new Set<ScreenName>([
  "title",
  "mapselect",
  "difficultyselect",
  "howto",
  "paused",
  "victory",
  "overload",
]);

export function isMenuScreen(screen: ScreenName): boolean {
  return MENU_SCREENS.has(screen);
}

/** The choices a screen offers, in the order they are presented. */
export function menuItems(screen: ScreenName): MenuItem[] {
  switch (screen) {
    case "title":
      return [
        { action: "salvage", label: TITLE_ITEMS[0] },
        { action: "howto", label: TITLE_ITEMS[1] },
      ];
    case "mapselect":
      return [
        ...MAPS.map((m): MenuItem => ({
          action: `map-${m.id}` as MenuAction,
          label: m.name,
        })),
        { action: "back", label: BACK_ITEM },
      ];
    case "difficultyselect":
      return [
        ...DIFFICULTIES.map((d): MenuItem => ({
          action: `difficulty-${d.id}` as MenuAction,
          label: d.name,
        })),
        { action: "back", label: BACK_ITEM },
      ];
    case "howto":
      return [{ action: "back", label: BACK_ITEM }];
    case "paused":
      return [
        { action: "resume", label: PAUSE_ITEMS[0] },
        { action: "restart", label: PAUSE_ITEMS[1] },
        { action: "quit", label: PAUSE_ITEMS[2] },
      ];
    case "victory":
      return [
        { action: "again", label: VICTORY_ITEMS[0] },
        { action: "menu", label: VICTORY_ITEMS[1] },
      ];
    case "overload":
      return [
        { action: "again", label: OVERLOAD_ITEMS[0] },
        { action: "menu", label: OVERLOAD_ITEMS[1] },
      ];
    default:
      return [];
  }
}
