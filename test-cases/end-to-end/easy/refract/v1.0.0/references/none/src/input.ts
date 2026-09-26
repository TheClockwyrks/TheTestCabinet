// Refract — input, as the runtime's named actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them (specs/controls.md), and the runtime does the listening, the
// edge detection, and the binding. Every read below is an edge read —
// Refract's keyboard only ever moves a highlight, accepts, leaves, clears, or
// mutes — and each edge is consumed by the first call that sees it, so every
// action is read in exactly one place per frame: `handleInput` in
// `src/game.ts`.
//
// The pointer is the other half of the input and is deliberately not here: its
// samples are resolved one at a time in `src/tracing.ts`, because a beam grows
// and unwinds node by node as the pointer travels.

import { ACTIONS, BINDINGS } from "./constants";
import type { InitApi, UpdateApi } from "./runtime";
import type { RefractState } from "./game";

/** Register every action in ACTIONS, bound to its keys. */
export function registerActions(
  api: Pick<InitApi<RefractState>, "input">,
): void {
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

export function clearPressed(api: UpdateApi): boolean {
  return api.input.pressed("clear");
}

export function mutePressed(api: UpdateApi): boolean {
  return api.input.pressed("mute");
}
