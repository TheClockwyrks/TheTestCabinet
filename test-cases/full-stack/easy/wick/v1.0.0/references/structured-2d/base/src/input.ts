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

/** A point on the stage, as a pointer sample reports one. */
export interface StagePoint {
  readonly x: number;
  readonly y: number;
}

/** The pointer as one frame delivered it, in stage coordinates. */
export interface PointerFrame {
  /**
   * Where a device reporting a position OUT of contact rests, or `null`.
   *
   * The hover position and nothing else: "only a device reporting a position
   * while out of contact moves the highlight this way" (specs/controls.md), so
   * a finger, which reports a position only while it is down, never lands here.
   */
  readonly at: StagePoint | null;
  /** The frame's primary press edges, in arrival order. */
  readonly presses: readonly StagePoint[];
  /** The frame's primary release edges, in arrival order. */
  readonly releases: readonly StagePoint[];
  /** The frame's wheel travel down the stage, in stage units. */
  readonly wheel: number;
}

/**
 * The pointing device's own contact state, carried across frames.
 *
 * A hover position and a hold are facts about the DEVICE rather than about the
 * game, so neither belongs in `WickState`, which `specs/state.md` declares in
 * full. A frame's samples say what changed; whether the pointer was already
 * down when the frame opened is what this remembers.
 */
const contact: { down: boolean; at: StagePoint | null } = {
  down: false,
  at: null,
};

/** Forget the contact, so a fresh game starts with nothing held or hovered. */
export function resetPointer(): void {
  contact.down = false;
  contact.at = null;
}

/**
 * This frame's pointer, read once from the single player controller.
 *
 * The frame's samples are walked in order, because the rules turn on WHERE each
 * edge fell rather than on where the pointer ended up: a press that lands in one
 * box and a lift that falls in another are two different points. A move made
 * while the pointer is down is not a hover, so a finger never hovers at all.
 */
export function pointerFrame(input: InputReader): PointerFrame {
  const presses: StagePoint[] = [];
  const releases: StagePoint[] = [];
  for (const sample of input.pointerSamples()) {
    const at = { x: sample.x, y: sample.y };
    if (sample.type === "down") {
      contact.down = true;
      contact.at = null;
      presses.push(at);
    } else if (sample.type === "up") {
      contact.down = false;
      contact.at = null;
      releases.push(at);
    } else if (!contact.down) {
      contact.at = at;
    }
  }
  return {
    at: contact.at === null ? null : { ...contact.at },
    presses,
    releases,
    wheel: input.wheel().y,
  };
}
