// Refract — the pointer, resolved: targets first, then the board.
//
// specs/controls.md gives every screen a set of pointer targets and the board
// the rest of the stage. A press inside a target moves the highlight and arms
// that target, a release inside the armed target takes it, and a release
// anywhere else takes nothing; on `playing` a press outside the two targets is a
// press on the board and runs the grab table in `src/tracing.ts`.
//
// The three functions below are the whole of that resolution, and both the
// per-frame sample loop in `src/game.ts` and the debug surface's pointer
// operations go through them, so a posed press and a player's press are the
// same event to the game (specs/instrumentation.md).
//
// A move with nothing held is a hover, which highlights the target under it.
// That is what a mouse gives for free and a touch never produces, so the press
// highlights too: a finger has no hover, and the press is what tells the player
// which item their release will take.

import { boardIndexOf, menuIndexOf, targetAt } from "./layout";
import { confirmItem, goBack } from "./flow";
import type { PointerDevice, RefractState } from "./game";
import {
  tryClearBeams,
  NO_EVENTS,
  pointerDown as tracePress,
  pointerMove as traceMove,
  pointerUp as traceRelease,
  type TraceResult,
} from "./tracing";

/** The highlight a target moves, when it names one. */
function highlight(state: RefractState, id: string): RefractState {
  const menu = menuIndexOf(id);
  if (menu !== null) return { ...state, menuIndex: menu };
  const board = boardIndexOf(id);
  if (board !== null) return { ...state, selectIndex: board };
  return state;
}

/**
 * Take a target: exactly what the same choice does from the keyboard
 * (specs/controls.md, Operating a screen with the pointer).
 */
function take(state: RefractState, id: string): TraceResult {
  if (id === "back") return { state: goBack(state), events: NO_EVENTS };
  if (id === "clear") {
    const { state: next, cleared } = tryClearBeams(state);
    return { state: next, events: { ...NO_EVENTS, cleared } };
  }
  const menu = menuIndexOf(id);
  if (menu !== null) {
    return { state: confirmItem(state, menu), events: NO_EVENTS };
  }
  const board = boardIndexOf(id);
  if (board !== null) {
    return {
      state: confirmItem({ ...state, selectIndex: board }, board),
      events: NO_EVENTS,
    };
  }
  return { state, events: NO_EVENTS };
}

/** A press: the target it lands in, or the board behind it. */
export function pointerDown(
  state: RefractState,
  x: number,
  y: number,
  device: PointerDevice = "mouse",
): TraceResult {
  const target = targetAt(state, x, y);
  if (target === null) return tracePress(state, x, y, device);
  // A press inside a target is taken by that target, whatever lies behind it,
  // so the controls on `playing` never grab a node (specs/controls.md).
  return {
    state: {
      ...highlight(state, target.id),
      pointer: { x, y, down: true, device },
      armedTarget: target.id,
    },
    events: NO_EVENTS,
  };
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
): TraceResult {
  if (state.armedTarget !== null) {
    return {
      state: { ...state, pointer: { x, y, down: state.pointer.down, device } },
      events: NO_EVENTS,
    };
  }
  if (!state.pointer.down) {
    const target = targetAt(state, x, y);
    const moved: RefractState = {
      ...state,
      pointer: { x, y, down: false, device },
    };
    return {
      state: target === null ? moved : highlight(moved, target.id),
      events: NO_EVENTS,
    };
  }
  return traceMove(state, x, y, device);
}

/** A release: it takes the armed target only when it lands inside it. */
export function pointerUp(
  state: RefractState,
  device: PointerDevice = "mouse",
): TraceResult {
  const armed = state.armedTarget;
  if (armed === null) return traceRelease(state, device);
  const under = targetAt(state, state.pointer.x, state.pointer.y);
  const lifted: RefractState = {
    ...state,
    pointer: { ...state.pointer, down: false, device },
    armedTarget: null,
  };
  if (under?.id !== armed) return { state: lifted, events: NO_EVENTS };
  return take(lifted, armed);
}
