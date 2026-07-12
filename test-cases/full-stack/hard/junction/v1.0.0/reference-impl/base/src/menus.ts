// Junction — menu definitions (specs/flow.md "Required menus", DESIGN §4, §5.2).
//
// A single source of truth for each state's menu items so the renderer draws them and the
// input layer's keyboard navigation (↑/↓ + Enter) drive the same list. Mirrors valence's
// `menus.ts`: the render and input slices agree on the item order and actions here.

import type { GameState } from "./types";
import type { Game } from "./sim";

export interface MenuItem {
  label: string;
  action: string;
}

// The navigable menu for a state; empty for the in-play states that have no list menu.
export function menuItems(state: GameState, game: Game): MenuItem[] {
  switch (state) {
    case "title":
      return [
        { label: game.mode.menuLabel, action: "menu:play" }, // "NEW CITY"
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
    case "bankrupt":
      return [
        { label: "TRY AGAIN", action: "menu:again" },
        { label: "MENU", action: "menu:menu" },
      ];
    default:
      return [];
  }
}
