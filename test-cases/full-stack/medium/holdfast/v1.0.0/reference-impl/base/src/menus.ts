// Holdfast — menu definitions (specs/flow.md "Required menus", DESIGN §5).
//
// A single source of truth for each menu's item list so the renderer (screens.ts) draws
// them and the input layer's keyboard navigation (Up/Down + Enter) drive the exact same
// list. The action strings are routed by main.ts; the labels are what the player reads.

import type { GameState } from "./types";
import type { Game } from "./sim";
import { MENU_ENTRY } from "./mode";

export interface MenuItem {
  label: string;
  action: string;
}

export function menuItems(state: GameState, _game: Game): MenuItem[] {
  switch (state) {
    case "title":
      return [
        { label: MENU_ENTRY, action: "menu:play" },
        { label: "HOW TO PLAY", action: "menu:howto" },
      ];
    case "howto":
      return [{ label: "BACK", action: "menu:back" }];
    case "paused":
      return [
        { label: "RESUME", action: "menu:resume" },
        { label: "RESTART", action: "menu:restart" },
        { label: "QUIT TO MENU", action: "menu:quit" },
      ];
    case "gameover":
      return [
        { label: "RESTART", action: "menu:again" },
        { label: "MENU", action: "menu:menu" },
      ];
    default:
      return [];
  }
}
