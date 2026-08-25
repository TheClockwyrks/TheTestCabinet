// Carom — input, as engine actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them, once, in the game instance's `initialize`, and the engine
// does the listening, the edge detection, and the binding. Every read after
// that goes through a player controller's `InputReader` — the one place the
// engine hands input out. Two consequences shape this file:
//
//   * A held read (`value`) is what drives continuous paddle motion; an edge
//     read (`pressed`) is what drives a menu move, a confirm, a pause, or a
//     mute, exactly once per press.
//   * An edge is consumed per controller by the first call that sees it and is
//     discarded at the end of the frame it was armed in. So every edge in
//     Carom is read through ONE controller — the primary player controller,
//     which routes them into its mode's `handleInput` — and the helpers below
//     are worded to make that obvious.
//
// The action names are not free: they are the `dual-vertical` layout's own
// vocabulary plus the menu vocabulary every layout carries, and
// `src/constants.ts` lists them in the layout's order.

import type { InitApi, InputReader } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";

/**
 * Register every action, bound to its keys.
 *
 * The engine's own layout vocabulary is checked against ACTIONS first, so an
 * action the layout speaks and Carom forgot is a hard failure at start-up
 * rather than a control that silently does nothing.
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
    api.input.register(action, BINDINGS[action]);
  }
}

/** Whether any of the given actions is held: `1` if so, `0` otherwise. */
function held(input: InputReader, ...actions: ActionName[]): number {
  return actions.some((action) => input.value(action) > 0) ? 1 : 0;
}

/**
 * A held axis, `down - up`, in `{-1, 0, 1}`. Negative is up, matching the
 * y-down field, and opposite actions held together stand still.
 */
function axis(
  input: InputReader,
  up: ActionName[],
  down: ActionName[],
): number {
  return held(input, ...down) - held(input, ...up);
}

/** Player one's slider: the left paddle in Versus, the human's in Solo. */
export function p1Axis(input: InputReader): number {
  return axis(input, ["p1-up"], ["p1-down"]);
}

/** Player two's slider: the right paddle in Versus. */
export function p2Axis(input: InputReader): number {
  return axis(input, ["p2-up"], ["p2-down"]);
}

/**
 * Solo has no player two, so both sliders drive the one human paddle — which
 * is what makes `W`/`S` and the arrow keys interchangeable there
 * (specs/modes/single-player.md): `up` is held while either side's up action
 * is, `down` likewise, and the axis is `down - up`.
 */
export function soloAxis(input: InputReader): number {
  return axis(input, ["p1-up", "p2-up"], ["p1-down", "p2-down"]);
}

/**
 * Either side's up action moves a menu selection up.
 *
 * Both are read and neither is short-circuited: an edge left unconsumed here
 * would be discarded at the end of the frame anyway, and reading both keeps
 * this frame's input fully accounted for.
 */
export function menuUp(input: InputReader): boolean {
  const p1 = input.pressed("p1-up");
  const p2 = input.pressed("p2-up");
  return p1 || p2;
}

/** Either side's down action moves a menu selection down. */
export function menuDown(input: InputReader): boolean {
  const p1 = input.pressed("p1-down");
  const p2 = input.pressed("p2-down");
  return p1 || p2;
}
