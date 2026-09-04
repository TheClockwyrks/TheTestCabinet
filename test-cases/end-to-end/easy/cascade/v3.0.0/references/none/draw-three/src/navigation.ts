// Cascade — the keyboard over a menu (specs/controls.md, Menu navigation).
//
// The runtime layer latches each frame's menu-action press edges
// (`src/keyboard.ts`); this is what the game does with them.
//
// THE ORDER WITHIN A FRAME IS FIXED, and it is the whole reason this is a
// function over the frame's edges rather than a handler per key.
// specs/controls.md: "When several edges arrive on one frame, `menu-up` is
// applied before `menu-down`, and movement before `menu-confirm`: a frame
// carrying both an up edge and a down edge moves up only, and a frame carrying
// a movement edge and a confirm edge moves only."
//
// So a frame resolves to AT MOST ONE MOVEMENT and, only where there was none,
// at most one confirm. `menu-back` is last, and it does something on exactly one
// screen.
//
// `won` READS NONE OF THE FOUR, because it shows no menu.

import { activateMenuItem, type InputAudio } from "./input";
import type { MenuAction } from "./keyboard";
import { menuItems, returnToTitle, wrapIndex } from "./menus";
import type { CascadeState } from "./state";

/** Apply the frame's menu-action edges, in the order the specification fixes. */
export function applyMenuActions(
  state: CascadeState,
  edges: readonly MenuAction[],
  audio: InputAudio,
): void {
  if (edges.length === 0) return;
  if (state.screen === "won") return;

  const held = new Set(edges);
  // The how-to screen carries one item, so movement over it changes nothing.
  const movable = menuItems(state.screen).length > 1;

  if (movable && held.has("menu-up")) {
    state.menuIndex = wrapIndex(state.screen, state.menuIndex - 1);
    return;
  }
  if (movable && held.has("menu-down")) {
    state.menuIndex = wrapIndex(state.screen, state.menuIndex + 1);
    return;
  }
  if (held.has("menu-confirm")) {
    activateMenuItem(state, audio);
    return;
  }
  if (held.has("menu-back") && state.screen === "howto") {
    // The one screen `menu-back` does anything on: it activates the item
    // labelled `HOWTO_BACK_LABEL`, exactly as a confirm there does.
    returnToTitle(state);
  }
}
