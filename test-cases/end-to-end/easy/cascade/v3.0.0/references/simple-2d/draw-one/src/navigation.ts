// Cascade — the keyboard over a menu (specs/controls.md, Menu navigation).
//
// The engine owns the keyboard: `src/game.ts` registers the four actions
// specs/controls.md names during `initialize`, and this reads their press edges
// back out of the frame.
//
// THE ORDER WITHIN A FRAME IS FIXED, and it is the whole reason this is one
// function over the frame rather than a handler per action. specs/controls.md:
// "When several edges arrive on one frame, `menu-up` is applied before
// `menu-down`, and movement before `menu-confirm`: a frame carrying both an up
// edge and a down edge moves up only, and a frame carrying a movement edge and a
// confirm edge moves only."
//
// So a frame resolves to AT MOST ONE MOVEMENT and, only where there was none, at
// most one confirm. `menu-back` is last, and it does something on exactly one
// screen.
//
// `won` READS NONE OF THE FOUR, because it shows no menu.

import { MENU_BACK, MENU_CONFIRM, MENU_DOWN, MENU_UP } from "./constants";
import type { CascadeState } from "./game";
import { menuItems, wrapMenuIndex } from "./layout";
import type { Outcome } from "./moves";
import { activateMenuItem } from "./pointer";
import type { UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";

/** The state a frame's menu-action edges left, and whatever they raised. */
export function applyMenuActions(
  state: DeepReadonly<CascadeState>,
  api: UpdateApi,
): Outcome {
  const here = state as CascadeState;
  if (here.screen === "won") return { state: here, cues: [] };

  // The how-to screen carries one item, so movement over it changes nothing.
  const movable = menuItems(here.screen).length > 1;

  if (movable && api.input.pressed(MENU_UP)) {
    return {
      state: {
        ...here,
        menuIndex: wrapMenuIndex(here.screen, here.menuIndex - 1),
      },
      cues: [],
    };
  }
  if (movable && api.input.pressed(MENU_DOWN)) {
    return {
      state: {
        ...here,
        menuIndex: wrapMenuIndex(here.screen, here.menuIndex + 1),
      },
      cues: [],
    };
  }
  if (api.input.pressed(MENU_CONFIRM)) {
    return activateMenuItem(here);
  }
  if (api.input.pressed(MENU_BACK) && here.screen === "howto") {
    // The one screen `menu-back` does anything on: it activates the item
    // labelled `HOWTO_BACK_LABEL`, exactly as a confirm there does.
    return activateMenuItem(here);
  }
  return { state: here, cues: [] };
}
