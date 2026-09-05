// Refract — input, as engine actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them (specs/controls.md), and the engine does the listening, the
// edge detection, and the binding. Every read below is an edge read — Refract's
// keyboard only ever moves a highlight, accepts, leaves, clears, or mutes — and
// each edge is consumed by the first call that sees it, so every action is read
// in exactly one place per frame: `handleInput` in `src/game.ts`.
//
// The pointer is the other half of the input and is deliberately not here: its
// samples are resolved one at a time in `src/tracing.ts`, because a beam grows
// and unwinds node by node as the pointer travels.

import { ACTIONS, BINDINGS, LAYOUT } from "./constants";
import type { InitApi, UpdateApi } from "@clockwyrks/simple-2d";

/**
 * Register every action in ACTIONS, bound to its keys.
 *
 * The engine's layout is checked first, so an engine stood up without the
 * `dpad-4` scheme this build is written against fails loudly at start-up
 * rather than shipping menus no key can move. ACTIONS is deliberately not the
 * layout's exact vocabulary: `clear` is Refract's own, beyond the layout, and
 * `pause` goes unregistered because a board is left with `back`, not paused
 * (src/constants.ts).
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null || layout.name !== LAYOUT) {
    throw new Error(
      `Refract: the engine must be built with the ${LAYOUT} layout` +
        (layout ? `, not ${layout.name}` : ""),
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
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
