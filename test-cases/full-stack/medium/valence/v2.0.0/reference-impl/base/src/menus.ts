// Valence — menu definitions (specs/campaign.md "Required menus").
//
// A single source of truth for each menu's items so the renderer draws them and the
// input layer's keyboard navigation (Up/Down + Enter) drive the same list.

import type { GameState } from "./types";
import type { Game } from "./sim";
import { MAPS } from "./board";

export interface MenuItem {
  label: string;
  action: string;
}

export function menuItems(state: GameState, game: Game): MenuItem[] {
  switch (state) {
    case "title":
      return [
        { label: game.mode.menuLabel, action: "menu:play" },
        { label: "HOW TO PLAY", action: "menu:howto" },
      ];
    case "mapselect":
      return [...MAPS.map((m) => ({ label: m.name, action: `map:${m.id}` })), { label: "BACK", action: "menu:back" }];
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
