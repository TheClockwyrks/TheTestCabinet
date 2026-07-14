// Midway — menu definitions (specs/flow.md "Required menus"; DESIGN.md §5).
//
// One source of truth for each menu's items, exactly as valence's menus.ts: the renderer
// draws them and the input layer's keyboard navigation (Up/Down + Enter) drives the same
// list, so the two never drift. The midway state machine has no map-select or victory step
// (the run is open-ended, lost only on bankruptcy), so the menus are title, how-to, the Esc
// pause overlay, and the park-closed game-over screen.

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
        { label: game.mode.menuLabel, action: "menu:play" },
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
        { label: "TRY AGAIN", action: "menu:again" },
        { label: "MENU", action: "menu:menu" },
      ];
    default:
      return [];
  }
}
