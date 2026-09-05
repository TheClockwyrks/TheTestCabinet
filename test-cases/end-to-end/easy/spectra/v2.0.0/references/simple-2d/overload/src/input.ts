// Spectra — input, as engine actions (`specs/controls.md`).
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the binding and the edge
// detection. Two rules follow from that:
//
//   * `left`, `right` and `a` are read as HOLDS, through `value`, because the ship
//     travels and the cannon repeats at its cadence while the key is down. The
//     cannon reads `a`'s press edge as well, so a tap that is down and up again
//     inside one frame still fires.
//   * `up`, `down`, `b`, `discharge`, `confirm`, `back`, `pause` and `mute` are
//     read as EDGES, through `pressed`, because each acts once per press. Every
//     edge is read here, whichever screen is showing, so none survives into the
//     next frame and none is consumed twice; the screen then decides which of them
//     means anything. That is what lets `Space` drive both `a` and `confirm`,
//     `ArrowUp` drive both `a` and `up`, and `Escape` drive both `pause` and
//     `back`.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type { InitApi, PointerSample, UpdateApi } from "@clockwyrks/simple-2d";

/** Everything a frame's input amounts to, resolved once per update. */
export interface FrameInput {
  /** The lane axis, `right - left`, in `{-1, 0, 1}`. Both held leaves it at 0. */
  readonly moveX: number;
  /** Whether the fire button is held. */
  readonly fire: boolean;
  /** The band flip, one press at a time. */
  readonly flip: boolean;
  /** The discharge release, one press at a time. */
  readonly discharge: boolean;
  readonly menuUp: boolean;
  readonly menuDown: boolean;
  readonly confirm: boolean;
  readonly back: boolean;
  readonly pause: boolean;
  readonly mute: boolean;
  /**
   * Every pointer sample the input frame collected, in arrival order.
   *
   * The menus take a mouse and a finger as well as the keyboard (`specs/ui.md`),
   * and the samples rather than the snapshot are what a menu reads: a sweep that
   * crossed two items between frames arrives as the positions it visited, so the
   * item it ENTERED last is the one selected.
   */
  readonly pointer: readonly PointerSample[];
}

/** Everything but the edges, which are news for exactly one sub-step. */
export function heldOnly(input: FrameInput): FrameInput {
  return {
    moveX: input.moveX,
    fire: input.fire,
    flip: false,
    discharge: false,
    menuUp: false,
    menuDown: false,
    confirm: false,
    back: false,
    pause: false,
    mute: false,
    // The pointer belongs to the frame, not to each of its sub-steps.
    pointer: [],
  };
}

/** No input at all, which is what a posed frame runs on. */
export const NO_INPUT: FrameInput = heldOnly({
  moveX: 0,
  fire: false,
  flip: false,
  discharge: false,
  menuUp: false,
  menuDown: false,
  confirm: false,
  back: false,
  pause: false,
  mute: false,
  pointer: [],
});

/**
 * Register every action, bound to its keys.
 *
 * The layout's own vocabulary is checked against `ACTIONS` first, so an action the
 * layout speaks and this build forgot is a failure at start-up rather than a
 * control that silently does nothing. `discharge` is Spectra's own and sits beyond
 * the layout, so the check is containment rather than equality.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null) {
    throw new Error(
      `Spectra: the engine was built without the ${LAYOUT} layout`,
    );
  }
  const missing = layout.actions.filter(
    (action) => !(ACTIONS as readonly string[]).includes(action),
  );
  if (missing.length > 0) {
    throw new Error(
      `Spectra: the ${layout.name} layout speaks [${missing.join(", ")}], ` +
        "which this build does not register",
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** Whether the action is held. */
function held(api: UpdateApi, action: ActionName): boolean {
  return api.input.value(action) > 0;
}

/** Read the whole of this frame's input, consuming every edge exactly once. */
export function readInput(api: UpdateApi): FrameInput {
  const left = held(api, "left") ? 1 : 0;
  const right = held(api, "right") ? 1 : 0;
  // The cannon reads the hold, and the press edge with it, so a tap short enough
  // to be down and up again inside one frame still fires exactly one shot.
  const fire = held(api, "a") || api.input.pressed("a");

  const menuUp = api.input.pressed("up");
  const menuDown = api.input.pressed("down");
  const flip = api.input.pressed("b");
  const discharge = api.input.pressed("discharge");
  const confirm = api.input.pressed("confirm");
  const back = api.input.pressed("back");
  const pause = api.input.pressed("pause");
  const mute = api.input.pressed("mute");

  return {
    moveX: right - left,
    fire,
    flip,
    discharge,
    menuUp,
    menuDown,
    confirm,
    back,
    pause,
    mute,
    pointer: api.input.pointerSamples(),
  };
}
