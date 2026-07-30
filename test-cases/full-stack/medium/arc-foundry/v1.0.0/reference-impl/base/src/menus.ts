// Arc Foundry — menu definitions (specs/ui.md "Required menus", specs/modes.md).
//
// A single source of truth for each menu's items so the renderer draws them and the input
// layer's pointer + keyboard navigation drive the same list. The Salvage start opens the
// MAP SELECT and then the DIFFICULTY SELECT before play (specs/ui.md, specs/modes.md).

import { DIFFICULTY_ORDER, DIFFICULTY, MAPS } from "./constants";
import type { GameState } from "./types";
import type { Game } from "./sim";

export interface MenuItem {
  label: string;
  action: string;
}

export function menuItems(state: GameState, game: Game): MenuItem[] {
  switch (state) {
    case "title":
      return [
        { label: game.campaign.menuLabel, action: "menu:play" },
        { label: "HOW TO PLAY", action: "menu:howto" },
      ];
    case "mapselect":
      return [...MAPS.map((m) => ({ label: m.name, action: `map:${m.id}` })), { label: "BACK", action: "menu:back" }];
    case "difficultyselect":
      return [
        ...DIFFICULTY_ORDER.map((d) => ({ label: DIFFICULTY[d].label, action: `diff:${d}` })),
        { label: "BACK", action: "menu:back" },
      ];
    case "howto":
      return [{ label: "BACK", action: "menu:back" }];
    case "paused":
      return [
        { label: "RESUME", action: "menu:resume" },
        { label: "RESTART", action: "menu:restart" },
        { label: "QUIT TO MENU", action: "menu:quit" },
      ];
    case "victory":
    case "defeat":
      return [
        { label: state === "victory" ? "PLAY AGAIN" : "TRY AGAIN", action: "menu:again" },
        { label: "MENU", action: "menu:menu" },
      ];
    default:
      return [];
  }
}

// The screens that ARE menus. `menuButtons()` reports nothing anywhere else — in match (building
// or mid-wave) and during the in-place pause, which shows no menu (specs/instrumentation.md).
const MENU_STATES: ReadonlySet<string> = new Set([
  "title",
  "mapselect",
  "difficultyselect",
  "howto",
  "paused",
  "victory",
  "defeat",
]);

export function isMenuState(state: GameState): boolean {
  return MENU_STATES.has(state);
}

// The debug API reports each menu choice under a FIXED identifier naming where it leads, so a
// caller can find a choice without knowing this build's internal action names or where it drew
// them (specs/instrumentation.md "menuButtons"). The internal names above are free to change;
// this table is the contract.
const DEBUG_ACTIONS: Readonly<Record<string, string>> = {
  "menu:play": "salvage",
  "menu:howto": "howto",
  "map:substation": "map-substation",
  "map:switchyard": "map-switchyard",
  "map:transformer": "map-transformer",
  "diff:easy": "difficulty-easy",
  "diff:medium": "difficulty-medium",
  "diff:hard": "difficulty-hard",
  "menu:back": "back",
  "menu:resume": "resume",
  "menu:restart": "restart",
  "menu:quit": "quit",
  "menu:again": "again",
  "menu:menu": "menu",
};

/** The contract identifier for an internal menu action, or null if it is not a menu choice. */
export function debugMenuAction(action: string): string | null {
  return DEBUG_ACTIONS[action] ?? null;
}
