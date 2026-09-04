// Shatter — input, as engine actions (`specs/controls.md`).
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the binding and the edge
// detection. Two rules follow from that:
//
//   * Turning, thrusting and firing are read as HOLDS, through `value`, because
//     the ship turns and accelerates for as long as the key is down and the gun
//     repeats at its own gate while it is held.
//   * `confirm`, `back`, `pause`, `mute` and the two menu moves are read as
//     EDGES, through `pressed`, because each acts once per press. An edge is
//     consumed by the first call that sees it and discarded at the end of the
//     frame, so every edge is read exactly once per frame, here, and the screen
//     decides which of them means anything. That is what lets `Escape` drive
//     both `pause` and `back`, and `Space` drive `a`, `b` and `confirm`: every
//     edge is armed, every edge is read, and the screen uses the one that
//     applies.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type {
  InitApi,
  PointerSample,
  UpdateApi,
} from "@test-cabinet/simple-2d";

/** Everything a frame's input amounts to, resolved once per update. */
export interface FrameInput {
  /** The turn axis, `right - left`, in `{-1, 0, 1}`. Positive turns clockwise. */
  readonly turn: number;
  /** Whether the thrust key is held. */
  readonly thrust: boolean;
  /** Whether either fire button is held. */
  readonly fire: boolean;

  /** The menu highlight moves, one press at a time. */
  readonly menuUp: boolean;
  readonly menuDown: boolean;
  readonly confirm: boolean;
  readonly back: boolean;
  readonly pause: boolean;
  readonly mute: boolean;

  /**
   * Every pointer and touch sample the frame delivered, in arrival order.
   *
   * `specs/ui.md` has the menus take a mouse and touch as well as the keys, and
   * has the pointer read once per frame in the same read as the keys. The
   * samples are carried whole rather than reduced to a position, because a sweep
   * that crossed several entries between two frames visited them in an order.
   */
  readonly pointer: readonly PointerSample[];
}

/** No key at all: what a tick beyond the first of a frame sees of the edges. */
export const NO_INPUT: FrameInput = {
  turn: 0,
  thrust: false,
  fire: false,
  menuUp: false,
  menuDown: false,
  confirm: false,
  back: false,
  pause: false,
  mute: false,
  pointer: [],
};

/**
 * The same frame's input with every edge spent.
 *
 * A frame that completes more than one tick applies its HOLDS to each of them —
 * the key really is still down — and its EDGES to the first alone, because one
 * press is one press however many ticks the frame turned out to be worth.
 */
export function withoutEdges(input: FrameInput): FrameInput {
  return {
    turn: input.turn,
    thrust: input.thrust,
    fire: input.fire,
    menuUp: false,
    menuDown: false,
    confirm: false,
    back: false,
    pause: false,
    mute: false,
    pointer: [],
  };
}

/**
 * Register every action, bound to its keys.
 *
 * The layout's own vocabulary is checked against `ACTIONS` first, so an action
 * the layout speaks and this build forgot is a failure at start-up rather than a
 * control that silently does nothing.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null) {
    throw new Error(
      `Shatter: the engine was built without the ${LAYOUT} layout`,
    );
  }
  if (layout.actions.join() !== ACTIONS.join()) {
    throw new Error(
      `Shatter: the ${layout.name} layout speaks [${layout.actions.join(", ")}], ` +
        `but this build registers [${ACTIONS.join(", ")}]`,
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action].keys] });
  }
}

/** Whether the action is held: `1` if so, `0` otherwise. */
function held(api: UpdateApi, action: ActionName): number {
  return api.input.value(action) > 0 ? 1 : 0;
}

/** Read the whole of this frame's input, consuming every edge exactly once. */
export function readInput(api: UpdateApi): FrameInput {
  const up = held(api, "up");
  const left = held(api, "left");
  const right = held(api, "right");
  const a = held(api, "a");
  const b = held(api, "b");

  // Every edge is read, whichever screen is showing, so none survives into the
  // next frame and none is left to be consumed twice.
  const menuUp = api.input.pressed("up");
  const menuDown = api.input.pressed("down");
  const confirm = api.input.pressed("confirm");
  const back = api.input.pressed("back");
  const pause = api.input.pressed("pause");
  const mute = api.input.pressed("mute");

  return {
    turn: right - left,
    thrust: up > 0,
    fire: a + b > 0,
    menuUp,
    menuDown,
    confirm,
    back,
    pause,
    mute,
    pointer: api.input.pointerSamples(),
  };
}
