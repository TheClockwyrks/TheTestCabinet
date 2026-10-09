// Carom — input, as named runtime actions.
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them (`BINDINGS` in `src/constants.ts`) and the runtime
// (`src/keyboard.ts`) does the listening, the edge detection, and the binding.
// Two consequences shape this file:
//
//   * Every read goes through the frame's `UpdateApi`. A held read (`value`) is
//     what drives continuous paddle motion; an edge read (`pressed`) is what
//     drives a menu move, a confirm, a pause, or a mute, exactly once per press.
//   * An edge is consumed by the first call that sees it and is discarded at the
//     end of the frame it was armed in. So each edge is read in exactly ONE place
//     per frame — `handleInput` in `src/game.ts` — and the reads below are worded
//     to make that obvious.

import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { InitApi, UpdateApi } from "./runtime";

/** Register every action Carom speaks, bound to the keys `BINDINGS` gives it. */
export function registerActions(api: InitApi): void {
  for (const action of ACTIONS) {
    api.input.register(action, BINDINGS[action]);
  }
}

/** Whether either of two held actions is down: `1` while one is, else `0`. */
function held(api: UpdateApi, ...actions: ActionName[]): number {
  return actions.some((action) => api.input.value(action) > 0) ? 1 : 0;
}

/** Player one's slider: `down - up`, so negative is up on the y-down field. */
export function p1Axis(api: UpdateApi): number {
  return held(api, "p1-down") - held(api, "p1-up");
}

/** Player two's slider: the right paddle in Versus. */
export function p2Axis(api: UpdateApi): number {
  return held(api, "p2-down") - held(api, "p2-up");
}

/**
 * Solo has no player two, so both sliders drive the one human paddle — which is
 * what makes `W`/`S` and the arrow keys interchangeable there
 * (specs/modes/single-player.md): `up` is held while either up action is, `down`
 * while either down action is, and the axis is `down - up`, so holding up on one
 * side and down on the other stands still.
 */
export function soloAxis(api: UpdateApi): number {
  return held(api, "p1-down", "p2-down") - held(api, "p1-up", "p2-up");
}

/**
 * Either side's up action moves a menu selection up.
 *
 * Both are read and neither is short-circuited: an edge left unconsumed here
 * would be discarded at the end of the frame anyway, and reading both keeps this
 * frame's input fully accounted for.
 */
export function menuUp(api: UpdateApi): boolean {
  const p1 = api.input.pressed("p1-up");
  const p2 = api.input.pressed("p2-up");
  return p1 || p2;
}

/** Either side's down action moves a menu selection down. */
export function menuDown(api: UpdateApi): boolean {
  const p1 = api.input.pressed("p1-down");
  const p2 = api.input.pressed("p2-down");
  return p1 || p2;
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
