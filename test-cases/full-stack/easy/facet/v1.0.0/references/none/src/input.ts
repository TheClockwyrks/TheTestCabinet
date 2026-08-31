// Facet — input, as the runtime's named actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the
// keys that drive them (specs/controls.md), and the runtime does the listening,
// the edge detection, and the binding. Every read below is an edge read — each
// of Facet's eight actions is "read once per frame as a press edge" — and each
// edge is consumed by the first call that sees it, so every action is read in
// exactly one place per frame: `handleInput` in `src/game.ts`.
//
// The pointer is the other half of the input and is deliberately not here: its
// samples are resolved one at a time through `src/core/controls.ts`, because a
// drag is decided by the positions the pointer passed through.

import { ACTIONS, BINDINGS } from "./constants";
import type { InitApi, UpdateApi } from "./runtime";
import type { FacetState } from "./core";

/** Register every action in `ACTIONS`, bound to the keys in `BINDINGS`. */
export function registerActions(api: Pick<InitApi<FacetState>, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, BINDINGS[action]);
  }
}

export function up(api: UpdateApi): boolean {
  return api.input.pressed("up");
}

export function down(api: UpdateApi): boolean {
  return api.input.pressed("down");
}

export function left(api: UpdateApi): boolean {
  return api.input.pressed("left");
}

export function right(api: UpdateApi): boolean {
  return api.input.pressed("right");
}

export function confirm(api: UpdateApi): boolean {
  return api.input.pressed("confirm");
}

export function back(api: UpdateApi): boolean {
  return api.input.pressed("back");
}

export function pause(api: UpdateApi): boolean {
  return api.input.pressed("pause");
}

export function mute(api: UpdateApi): boolean {
  return api.input.pressed("mute");
}
