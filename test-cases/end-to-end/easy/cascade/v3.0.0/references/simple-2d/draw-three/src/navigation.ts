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
// `won` READS NONE OF THE FOUR, because it shows no menu.

import { MENU_BACK, MENU_CONFIRM, MENU_DOWN, MENU_UP } from "./constants";
import { menuItems, wrapMenuIndex } from "./menus";
import { activateMenuItem } from "./pointer";
import type { Sim } from "./sim";
import type { UpdateApi } from "@clockwyrks/simple-2d";

/** Apply the frame's menu-action edges, in the order the specification fixes. */
export function applyMenuActions(sim: Sim, api: UpdateApi): void {
  if (sim.screen === "won") return;

  // The how-to screen carries one item, so movement over it changes nothing.
  const movable = menuItems(sim.screen).length > 1;

  if (movable && api.input.pressed(MENU_UP)) {
    sim.menuIndex = wrapMenuIndex(sim.screen, sim.menuIndex - 1);
    return;
  }
  if (movable && api.input.pressed(MENU_DOWN)) {
    sim.menuIndex = wrapMenuIndex(sim.screen, sim.menuIndex + 1);
    return;
  }
  if (api.input.pressed(MENU_CONFIRM)) {
    activateMenuItem(sim);
    return;
  }
  if (api.input.pressed(MENU_BACK) && sim.screen === "howto") {
    // The one screen `menu-back` does anything on: it activates the item
    // labelled `HOWTO_BACK_LABEL`, exactly as a confirm there does.
    activateMenuItem(sim);
  }
}
