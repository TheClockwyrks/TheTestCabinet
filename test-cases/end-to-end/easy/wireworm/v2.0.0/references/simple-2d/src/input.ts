// Wireworm — input, as engine actions (`specs/controls.md`).
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the binding and the edge
// detection. Two rules follow from that:
//
//   * A movement or a fire action is read as a HOLD, through `value`, because
//     the cursor travels and the gun repeats while the key is down.
//   * `confirm`, `back`, `pause` and `mute` are read as EDGES, through
//     `pressed`, because each acts once per press. An edge is consumed by the
//     first call that sees it and discarded at the end of the frame, so every
//     edge is read exactly once per frame, here, and the screen decides which of
//     them means anything. That is what lets `Escape` drive both `pause` and
//     `back` and `Space` drive both `a` and `confirm`: both edges are armed,
//     both are read, and the screen uses the one that applies.

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type {
  InitApi,
  PointerSample,
  UpdateApi,
} from "@test-cabinet/simple-2d";

/** Everything a frame's input amounts to, resolved once per update. */
export interface FrameInput {
  /** The horizontal movement axis, `right - left`, in `{-1, 0, 1}`. */
  readonly mx: number;
  /** The vertical movement axis, `down - up`, in `{-1, 0, 1}`. */
  readonly my: number;
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
   * Every pointer sample the frame delivered, in arrival order.
   *
   * The menus take a mouse and a finger as well as the keyboard
   * (`specs/ui.md`), and they are read in this same once-per-frame read rather
   * than through an action.
   */
  readonly pointer: readonly PointerSample[];
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
      `Wireworm: the engine was built without the ${LAYOUT} layout`,
    );
  }
  if (layout.actions.join() !== ACTIONS.join()) {
    throw new Error(
      `Wireworm: the ${layout.name} layout speaks [${layout.actions.join(", ")}], ` +
        `but this build registers [${ACTIONS.join(", ")}]`,
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** Whether the action is held: `1` if so, `0` otherwise. */
function held(api: UpdateApi, action: ActionName): number {
  return api.input.value(action) > 0 ? 1 : 0;
}

/** Read the whole of this frame's input, consuming every edge exactly once. */
export function readInput(api: UpdateApi): FrameInput {
  const up = held(api, "up");
  const down = held(api, "down");
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
    mx: right - left,
    my: down - up,
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
