// Wick — input, as engine actions and the pointer (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It registers the
// eight named actions with the keys that drive them, and the engine does the
// listening, the edge detection, and the binding, so a dispatched keyboard
// event moves the lamplighter exactly as a player's key does because there is
// only one path. The pointer arrives the same way, already in the stage's own
// coordinates whatever the canvas's size on the page, so nothing here maps a
// client position.
//
// The four movement actions are read as held values through `input.value` on
// `playing`; every action is a press edge on the menus. The engine's edges
// are consumed per controller at the first call that reads them, so every
// edge is read in exactly one place: `pressedActions` below, called once a
// frame from the single player controller in `src/controller.ts`.
//
// `Backquote` is deliberately absent. The debug overlay's toggle is engine
// chrome rather than a game action, so the registry stays exactly the
// vocabulary `src/constants.ts` fixes.

import type { InitApi, InputReader } from "@test-cabinet/structured-2d";
import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { Held } from "./state";

/** Register every action in `ACTIONS`, bound to its keys. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** The four movement actions as held values, `1` while down. */
export function heldMovement(input: InputReader): Held {
  return {
    up: input.value("up") > 0 ? 1 : 0,
    down: input.value("down") > 0 ? 1 : 0,
    left: input.value("left") > 0 ? 1 : 0,
    right: input.value("right") > 0 ? 1 : 0,
  };
}

/**
 * This frame's press edges, in the order `ACTIONS` declares them. Each edge
 * is read exactly once, which is what the reader's consume-on-read edges ask
 * for.
 */
export function pressedActions(input: InputReader): ActionName[] {
  return ACTIONS.filter((action) => input.pressed(action));
}

/** The pointer as one frame delivered it, in stage coordinates. */
export interface PointerFrame {
  /** Where the pointer rests, which is what a hover reads. */
  readonly x: number;
  readonly y: number;
  /** Where this frame's primary press edge landed, or `null` for none. */
  readonly press: { readonly x: number; readonly y: number } | null;
  /** The frame's wheel travel down the stage, in stage units. */
  readonly wheel: number;
}

/**
 * This frame's pointer, read once from the single player controller. The
 * press is placed at the `down` sample that armed it rather than at the
 * pointer's resting position, so a click acts where the button went down even
 * on a frame that moved on afterwards; past the reader's sample cap the
 * resting position stands in.
 */
export function pointerFrame(input: InputReader): PointerFrame {
  const at = input.pointer();
  let press: { x: number; y: number } | null = null;
  if (input.pointerPressed()) {
    press = { x: at.x, y: at.y };
    for (const sample of input.pointerSamples()) {
      if (sample.type !== "down") continue;
      if (!sample.primary || sample.button !== "primary") continue;
      press = { x: sample.x, y: sample.y };
    }
  }
  return { x: at.x, y: at.y, press, wheel: input.wheel().y };
}
