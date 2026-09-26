// Cascade — the keyboard over a menu (specs/controls.md, Menu navigation).
//
// The engine owns the keyboard: `src/game.ts` registers the four actions
// specs/controls.md names when the game initializes, and the player controller
// reads their press edges out of the frame it ticks in.
//
// THE ORDER WITHIN A FRAME IS FIXED, and it is the whole reason this is one
// function over the frame rather than a handler per action. specs/controls.md:
// "When several edges arrive on one frame, `menu-up` is applied before
// `menu-down`, and movement before `menu-confirm`: a frame carrying both an up
// edge and a down edge moves up only, and a frame carrying a movement edge and a
// confirm edge moves only."
//
// EVERY EDGE IS CONSUMED EVEN WHERE IT IS NOT APPLIED, because the engine hands
// each `pressed` out exactly once per controller: leaving one unread would let a
// later frame apply an edge that arrived on this one.
//
// `won` READS NONE OF THE FOUR, because it shows no menu.

import type { FrameCues } from "./audio";
import { MENU_BACK, MENU_CONFIRM, MENU_DOWN, MENU_UP } from "./constants";
import type { CascadeState } from "./game";
import { activateMenuItem } from "./input";
import { menuItems, wrapMenuIndex } from "./menus";

/** What a controller reads its actions through. */
export interface MenuInput {
  pressed(name: string): boolean;
}

/** Apply the frame's menu-action edges, in the order the specification fixes. */
export function applyMenuActions(
  state: CascadeState,
  input: MenuInput,
  cues: FrameCues,
): void {
  // Read in one go, so every edge is consumed whatever the screen does with it.
  const up = input.pressed(MENU_UP);
  const down = input.pressed(MENU_DOWN);
  const confirm = input.pressed(MENU_CONFIRM);
  const back = input.pressed(MENU_BACK);

  if (state.screen === "won") return;

  // The how-to screen carries one item, so movement over it changes nothing.
  const movable = menuItems(state.screen).length > 1;

  if (movable && up) {
    state.menuIndex = wrapMenuIndex(state.screen, state.menuIndex - 1);
    return;
  }
  if (movable && down) {
    state.menuIndex = wrapMenuIndex(state.screen, state.menuIndex + 1);
    return;
  }
  if (confirm) {
    activateMenuItem(state, cues);
    return;
  }
  if (back && state.screen === "howto") {
    // The one screen `menu-back` does anything on: it activates the item
    // labelled `HOWTO_BACK_LABEL`, exactly as a confirm there does.
    activateMenuItem(state, cues);
  }
}
