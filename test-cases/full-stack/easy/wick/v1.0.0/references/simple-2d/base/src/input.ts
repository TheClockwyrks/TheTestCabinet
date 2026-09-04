// Wick — input, as engine actions and as the pointer (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It registers the
// eight named actions with the keys that drive them, and the engine does the
// listening, the edge detection, and the binding. The four movement actions
// are read as held values once per frame and applied to every tick the frame
// consumes; every action is read as a press edge exactly once per frame, and
// the screen the frame began on decides which edges it answers. The pointer
// arrives already in the stage's own coordinates, its press edge and its
// wheel travel with it, so nothing here maps a client position.
// `Backquote` is absent: the overlay's toggle is engine chrome.

import type { InitApi, UpdateApi } from "@test-cabinet/simple-2d";
import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { PointerInput } from "./flow";
import type { Held } from "./sim/context";

/** Register every action in `ACTIONS`, bound to its keys. */
export function registerActions(api: Pick<InitApi, "input">): void {
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** This frame's movement holds, sampled once and shared by every tick. */
export function readHeld(api: Pick<UpdateApi, "input">): Held {
  return {
    up: api.input.value("up") > 0 ? 1 : 0,
    down: api.input.value("down") > 0 ? 1 : 0,
    left: api.input.value("left") > 0 ? 1 : 0,
    right: api.input.value("right") > 0 ? 1 : 0,
  };
}

/** This frame's press edges, in the order `ACTIONS` declares them. */
export function pressedActions(api: Pick<UpdateApi, "input">): ActionName[] {
  return ACTIONS.filter((action) => api.input.pressed(action));
}

/**
 * This frame's pointer: where the primary pointer rests, whether its primary
 * button's press edge fell on this frame, and the frame's wheel travel down
 * the stage. Each edge is consumed by the read, so this is called once.
 */
export function readPointer(api: Pick<UpdateApi, "input">): PointerInput {
  const pointer = api.input.pointer();
  return {
    x: pointer.x,
    y: pointer.y,
    clicked: api.input.pointerPressed("primary"),
    wheel: api.input.wheel().y,
  };
}
