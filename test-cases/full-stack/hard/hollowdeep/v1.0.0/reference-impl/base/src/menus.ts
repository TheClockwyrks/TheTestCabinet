// Hollowdeep — menu definitions (specs/flow.md "Required menus", DESIGN §6).
//
// A single source of truth for each menu state's item list, so the renderer draws them
// (src/render.ts) and the input layer's keyboard navigation (Up/Down + Enter) drive the
// exact same list (src/input.ts + src/main.ts). Mirrors valence's menus.ts. The colony
// game has NO win screen — survival is open-ended — so there is only a colony-lost
// (`gameover`) end state, offering RESTART / MENU.

import type { GameState } from "./types";
import type { Game } from "./sim";

export interface MenuItem {
  label: string;
  action: string;
}

export function menuItems(state: GameState, game: Game): MenuItem[] {
  switch (state) {
    case "title":
      // The mode base labels its own entry (NEW COLONY), then HOW TO PLAY (specs/mode.md).
      return [
        { label: game.mode.menuLabel, action: "menu:play" },
        { label: "HOW TO PLAY", action: "menu:howto" },
      ];
    case "howto":
      return [{ label: "BACK", action: "menu:back" }];
    case "paused":
      // The Esc pause menu freezes the field behind it (specs/flow.md).
      return [
        { label: "RESUME", action: "menu:resume" },
        { label: "RESTART", action: "menu:restart" },
        { label: "QUIT TO MENU", action: "menu:quit" },
      ];
    case "gameover":
      return [
        { label: "RESTART", action: "menu:restart" },
        { label: "MENU", action: "menu:menu" },
      ];
    default:
      return [];
  }
}
