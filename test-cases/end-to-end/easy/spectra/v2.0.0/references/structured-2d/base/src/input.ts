// Spectra — input, as engine actions (`specs/controls.md`).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the binding and the edge
// detection. Two rules follow from that:
//
//   * `left`, `right` and `a` are read as HOLDS, through `value`, because the
//     ship travels while a direction is held and the cannon repeats while fire
//     is held.
//   * `up`, `down`, `b`, `discharge`, `confirm`, `back`, `pause` and `mute` are
//     read as EDGES, through `pressed`, because each acts once per press. An
//     edge is consumed by the first read within one controller and discarded at
//     the end of the frame, so every edge is read exactly once per frame — in
//     the player controller — and the SCREEN decides which of them means
//     anything. That is what lets `Escape` drive both `pause` and `back`, `Space`
//     drive both `a` and `confirm`, and `ArrowUp` drive both `a` and `up`: every
//     edge is armed, every edge is read, and the screen uses the one that
//     applies to it.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type {
  InitApi,
  InputReader,
  PointerSample,
} from "@test-cabinet/structured-2d";

/** Everything a frame's input amounts to, resolved once per frame. */
export interface FrameInput {
  /** The horizontal movement axis, `right - left`, in `{-1, 0, 1}`. */
  readonly mx: number;
  /** Whether the fire action is held. */
  readonly fire: boolean;
  /** The flip, once per press. */
  readonly flip: boolean;
  /** The discharge, once per press. */
  readonly discharge: boolean;
  /** A menu highlight moves, one press at a time. */
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

/** A frame in which the player did nothing, which is what a pose steps under. */
export const IDLE_INPUT: FrameInput = {
  mx: 0,
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
};

/**
 * Register every action, bound to its keys.
 *
 * The selected layout's own vocabulary is checked against `ACTIONS` first, so an
 * action the layout speaks and this build forgot is a failure at start-up rather
 * than a control that silently does nothing. `ACTIONS` is deliberately WIDER
 * than the layout: `discharge` is Spectra's own action, registered beyond it.
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
        `which this build does not register`,
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** Whether the action is held: `1` if so, `0` otherwise. */
function held(reader: InputReader, action: ActionName): number {
  return reader.value(action) > 0 ? 1 : 0;
}

/** Read the whole of this frame's input, consuming every edge exactly once. */
export function readInput(reader: InputReader): FrameInput {
  const left = held(reader, "left");
  const right = held(reader, "right");
  const fire = held(reader, "a") > 0;

  // Every edge is read, whichever screen is showing, so none survives into the
  // next frame and none is left to be consumed twice.
  const menuUp = reader.pressed("up");
  const menuDown = reader.pressed("down");
  const flip = reader.pressed("b");
  const discharge = reader.pressed("discharge");
  const confirm = reader.pressed("confirm");
  const back = reader.pressed("back");
  const pause = reader.pressed("pause");
  const mute = reader.pressed("mute");

  return {
    mx: right - left,
    fire,
    flip,
    discharge,
    menuUp,
    menuDown,
    confirm,
    back,
    pause,
    mute,
    pointer: reader.pointerSamples(),
  };
}
