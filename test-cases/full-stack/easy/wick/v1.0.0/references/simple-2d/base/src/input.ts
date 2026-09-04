// Wick — input, as engine actions and as the pointer (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `PointerEvent`. It registers the
// eight named actions with the keys that drive them, and the engine does the
// listening, the edge detection, and the binding. The four movement actions
// are read as held values once per frame and applied to every tick the frame
// consumes; every action is read as a press edge exactly once per frame, and
// the screen the frame began on decides which edges it answers. The pointer
// arrives already in the stage's own coordinates, its samples and its wheel
// travel with it, so nothing here maps a client position.
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
 * The pointing device's own contact state, carried across frames.
 *
 * A hover position and a hold are facts about the DEVICE rather than about the
 * game, so neither belongs in `WickState`, which `specs/state.md` declares in
 * full. `specs/controls.md` makes the hover "a device reporting a position
 * while out of contact", which is the one thing a frame's samples cannot say on
 * their own: the samples say what changed, and whether the pointer was already
 * down when the frame opened is what this remembers.
 */
const contact: { down: boolean; at: { x: number; y: number } | null } = {
  down: false,
  at: null,
};

/** Forget the contact, so a fresh game starts with nothing held or hovered. */
export function resetPointer(): void {
  contact.down = false;
  contact.at = null;
}

/**
 * This frame's pointer: where a device reporting a position OUT of contact
 * rests, the frame's press and release edges in arrival order, and the frame's
 * wheel travel down the stage.
 *
 * The frame's samples are walked in order, because the rules turn on WHERE each
 * edge fell rather than on where the pointer ended up: a press that lands in one
 * box and a lift that falls in another are two different points. A move made
 * while the pointer is down is not a hover, so a finger, which reports a
 * position only while it is in contact, never hovers at all. Each edge is
 * consumed by the read, so this is called once.
 */
export function readPointer(api: Pick<UpdateApi, "input">): PointerInput {
  const presses: { x: number; y: number }[] = [];
  const releases: { x: number; y: number }[] = [];
  for (const sample of api.input.pointerSamples()) {
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
    wheel: api.input.wheel().y,
  };
}
