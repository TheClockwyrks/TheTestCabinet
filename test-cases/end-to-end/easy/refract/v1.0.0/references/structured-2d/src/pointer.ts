// Refract — the pointer, resolved: targets first, then the board.
//
// specs/controls.md gives every screen a set of pointer targets and the board
// the rest of the stage. A press inside a target moves the highlight and arms
// that target, a release inside the armed target takes it, and a release
// anywhere else takes nothing; on `playing` a press outside the two targets is a
// press on the board and runs the grab table in `src/tracing.ts`.
//
// This module is the whole of that resolution, and both the player controller's
// per-sample loop and the debug surface's pointer operations go through it, so a
// posed press and a player's press are the same event to the game
// (specs/instrumentation.md).
//
// A move with nothing held is a hover, which highlights the target under it.
// That is what a mouse gives for free and a touch never produces, so the press
// highlights too: a finger has no hover, and the press is what tells the player
// which item their release will take.

import type { PointerSample } from "@test-cabinet/structured-2d";
import { confirmItem, goBack } from "./flow";
import type { PointerDevice, RefractState } from "./game";
import { boardIndexOf, menuIndexOf, targetAt } from "./layout";
import {
  clearBeams,
  noEvents,
  pointerDown as tracePress,
  pointerMove as traceMove,
  pointerUp as traceRelease,
  type TraceEvents,
} from "./tracing";

/** The highlight a target moves, when it names one. */
function highlight(state: RefractState, id: string): void {
  const menu = menuIndexOf(id);
  if (menu !== null) {
    state.menuIndex = menu;
    return;
  }
  const board = boardIndexOf(id);
  if (board !== null) state.selectIndex = board;
}

/**
 * Take a target: exactly what the same choice does from the keyboard
 * (specs/controls.md, Operating a screen with the pointer).
 */
function take(state: RefractState, id: string): TraceEvents {
  const events = noEvents();
  if (id === "back") {
    goBack(state);
    return events;
  }
  if (id === "clear") {
    events.cleared = clearBeams(state);
    return events;
  }
  const menu = menuIndexOf(id);
  if (menu !== null) {
    confirmItem(state, menu);
    return events;
  }
  const board = boardIndexOf(id);
  if (board !== null) {
    state.selectIndex = board;
    confirmItem(state, board);
  }
  return events;
}

/** A press: the target it lands in, or the board behind it. */
export function pointerDown(
  state: RefractState,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): TraceEvents {
  const target = targetAt(state, x, y);
  if (target === null) return tracePress(state, x, y, device);
  // A press inside a target is taken by that target, whatever lies behind it,
  // so the controls on `playing` never grab a node (specs/controls.md).
  state.pointer = { x, y, down: true, device };
  state.armedTarget = target.id;
  highlight(state, target.id);
  return noEvents();
}

/**
 * A move: a hover highlights, and a move with a target armed changes nothing
 * but where the pointer is, since only the release decides what is taken.
 */
export function pointerMove(
  state: RefractState,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): TraceEvents {
  if (state.armedTarget !== null) {
    state.pointer = { x, y, down: state.pointer.down, device };
    return noEvents();
  }
  if (!state.pointer.down) {
    state.pointer = { x, y, down: false, device };
    const target = targetAt(state, x, y);
    if (target !== null) highlight(state, target.id);
    return noEvents();
  }
  return traceMove(state, x, y, device);
}

/** A release: it takes the armed target only when it lands inside it. */
export function pointerUp(
  state: RefractState,
  device: PointerDevice = "mouse",
): TraceEvents {
  const armed = state.armedTarget;
  if (armed === null) return traceRelease(state, device);
  const under = targetAt(state, state.pointer.x, state.pointer.y);
  state.pointer = { ...state.pointer, down: false, device };
  state.armedTarget = null;
  if (under?.id !== armed) return noEvents();
  return take(state, armed);
}

/**
 * One of the engine's ordered pointer samples, resolved on its own — the
 * dispatch the player controller runs per sample, in arrival order, so a sweep
 * that crossed several nodes between two frames grows or unwinds the beam node
 * by node rather than jumping to the last position.
 */
export function applySample(
  state: RefractState,
  sample: PointerSample,
): TraceEvents {
  switch (sample.type) {
    case "down":
      return pointerDown(state, sample.x, sample.y, sample.device);
    case "move":
      return pointerMove(state, sample.x, sample.y, sample.device);
    case "up":
      return pointerUp(state, sample.device);
  }
}
