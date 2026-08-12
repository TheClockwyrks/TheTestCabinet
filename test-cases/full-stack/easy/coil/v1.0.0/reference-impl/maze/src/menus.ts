// Coil — the menu item list for each menu-bearing state (specs/ui.md "Game states").
//
// A single source of truth for both navigation (main.ts moves the highlight and activates
// the selected action) and drawing (render.ts lays the items out). `HOW TO PLAY` is always
// last on the title menu; the play entry above it is named for the build's mode.

import type { Game, State } from "./game";

export interface MenuItem {
  label: string;
  action: string;
}

export function menuItems(state: State, game: Game): MenuItem[] {
  switch (state) {
    case "title":
      return [
        { label: game.mode === "maze" ? "MAZE" : "CLASSIC", action: "start" },
        { label: "HOW TO PLAY", action: "howto" },
      ];
    case "howto":
      return [{ label: "BACK", action: "menu" }];
    case "paused":
      return [
        { label: "RESUME", action: "resume" },
        { label: "RESTART", action: "restart" },
        { label: "QUIT TO MENU", action: "menu" },
      ];
    case "gameover":
    case "cleared":
      return [
        { label: "PLAY AGAIN", action: "start" },
        { label: "MENU", action: "menu" },
      ];
    default:
      return [];
  }
}
