// Facet — input, as the runtime's named actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the
// keys that drive them (specs/controls.md), and the runtime does the listening,
// the edge detection, and the binding. Every read below is an edge read — each
// of Facet's six actions is "read once per frame as a press edge" — and each
// edge is consumed by the first call that sees it, so every action is read in
// exactly one place per frame: `handleInput` in `src/game.ts`.
//
// THE KEYBOARD'S WHOLE JOB IS THE MENUS. The board is played with the pointer
// alone, so there is no movement over cells here and no `confirm` on the board:
// `up` and `down` move a menu highlight, `confirm` takes it, `pause` and `back`
// leave a screen, and `mute` is read on every screen.
//
// The pointer is the other half of the input and is deliberately not here: its
// samples are resolved one at a time through `src/core/controls.ts`, because a
// hold is decided by the positions the pointer passed through.

import { ACTIONS, BINDINGS } from "./constants";
import type { InitApi, UpdateApi } from "./runtime";
import type { FacetState } from "./core";

/** Register every action in `ACTIONS`, bound to the keys in `BINDINGS`. */
export function registerActions(api: Pick<InitApi<FacetState>, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, BINDINGS[action]);
  }
}

/** The menu highlight moves up one item. */
export function up(api: UpdateApi): boolean {
  return api.input.pressed("up");
}

/** The menu highlight moves down one item. */
export function down(api: UpdateApi): boolean {
  return api.input.pressed("down");
}

/** The highlighted menu item is taken. */
export function confirm(api: UpdateApi): boolean {
  return api.input.pressed("confirm");
}

/** `howto` and `gameover` are left. Bound to `Escape`, alongside `pause`. */
export function back(api: UpdateApi): boolean {
  return api.input.pressed("back");
}

/** The pause menu is entered and left. Bound to `Escape` and `KeyP`. */
export function pause(api: UpdateApi): boolean {
  return api.input.pressed("pause");
}

/** The runtime's mute bit is toggled, from any screen. */
export function mute(api: UpdateApi): boolean {
  return api.input.pressed("mute");
}
