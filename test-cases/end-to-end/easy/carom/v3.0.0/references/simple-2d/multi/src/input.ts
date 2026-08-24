// Carom — input, as engine actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the edge detection, and the
// binding. Two consequences shape this file:
//
//   * Every read goes through the frame's `UpdateApi`. A held read (`value`) is
//     what drives continuous paddle motion; an edge read (`pressed`) is what drives
//     a menu move, a confirm, a pause, or a mute, exactly once per press.
//   * An edge is consumed by the first call that sees it and is discarded at the
//     end of the frame it was armed in. So each edge is read in exactly ONE place
//     per frame — `handleInput` in `src/game.ts` — and the reads below are worded
//     to make that obvious.
//
// The action names are not free: they are the `dual-vertical` layout's own
// vocabulary plus the menu vocabulary every layout carries, and `src/constants.ts`
// lists them in the layout's order.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type { InitApi, UpdateApi } from "@test-cabinet/simple-2d";

/**
 * Register every action, bound to its keys.
 *
 * The engine's own layout vocabulary is checked against ACTIONS first, so an
 * action the layout speaks and Carom forgot is a hard failure at start-up rather
 * than a control that silently does nothing. Only the `input` half of the API is
 * asked for, because that is all this module touches.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null) {
    throw new Error(`Carom: the engine was built without the ${LAYOUT} layout`);
  }
  if (layout.actions.join() !== ACTIONS.join()) {
    throw new Error(
      `Carom: the ${layout.name} layout speaks [${layout.actions.join(", ")}], ` +
        `but this build registers [${ACTIONS.join(", ")}]`,
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** A held axis in `[-1, 1]`. Negative is up, matching the y-down field. */
function axis(api: UpdateApi, up: ActionName, down: ActionName): number {
  return api.input.value(down) - api.input.value(up);
}

/** Player one's slider: the left paddle in Versus, the human's in Solo. */
export function p1Axis(api: UpdateApi): number {
  return axis(api, "p1-up", "p1-down");
}

/** Player two's slider: the right paddle in Versus. */
export function p2Axis(api: UpdateApi): number {
  return axis(api, "p2-up", "p2-down");
}

/**
 * Solo has no player two, so both sliders drive the one human paddle — which is
 * what makes `W`/`S` and the arrow keys interchangeable there
 * (specs/modes/single-player.md): `up` is held while either side's up action is,
 * `down` likewise, and the axis is `down - up`.
 */
export function soloAxis(api: UpdateApi): number {
  const up = Math.max(api.input.value("p1-up"), api.input.value("p2-up"));
  const down = Math.max(api.input.value("p1-down"), api.input.value("p2-down"));
  return down - up;
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
