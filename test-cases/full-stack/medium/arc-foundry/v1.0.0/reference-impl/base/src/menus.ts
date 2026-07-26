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
