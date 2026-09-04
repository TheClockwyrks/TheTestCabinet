// Wireworm — input, as named runtime actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them (`BINDINGS` in `src/constants.ts`) and the runtime
// (`src/keyboard.ts`) does the listening, the edge detection, and the binding.
//
// The four movement actions and the two fire actions are read as HOLDS, and
// `confirm`, `back`, `pause` and `mute` as EDGES, once per press. An edge is
// consumed by the first call that sees it and discarded at the end of its frame,
// so each one is read in exactly one place per frame — `handleInput` in
// `src/game.ts` — and the reads below are worded to make that obvious.

import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { InitApi, UpdateApi } from "./runtime";
import type { MoveAxis } from "./cursor";

/** Register every action Wireworm answers to, bound to the keys `BINDINGS` gives it. */
export function registerActions(api: InitApi): void {
  for (const action of ACTIONS) api.input.register(action, BINDINGS[action]);
}

/** Whether an action is held, as `1` or `0`. */
function held(api: UpdateApi, action: ActionName): number {
  return api.input.value(action) > 0 ? 1 : 0;
}

/** The frame's movement, as `right - left` and `down - up`. */
export function moveAxis(api: UpdateApi): MoveAxis {
  return {
    x: held(api, "right") - held(api, "left"),
    y: held(api, "down") - held(api, "up"),
  };
}

/** Whether either fire action is held. */
export function firing(api: UpdateApi): boolean {
  return held(api, "a") > 0 || held(api, "b") > 0;
}

/**
 * A menu move upward.
 *
 * Both fire actions are deliberately not involved: the two buttons of the pad
 * fire, and the menu is driven by the movement pad and `confirm`.
 */
export function menuUp(api: UpdateApi): boolean {
  return api.input.pressed("up");
}

export function menuDown(api: UpdateApi): boolean {
  return api.input.pressed("down");
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
