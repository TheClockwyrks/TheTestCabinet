// Floe — input, as engine actions (`specs/controls.md`).
//
// The game never sees a `KeyboardEvent`. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the binding and the edge
// detection. Two rules follow from `specs/controls.md`'s "How each one is read":
//
//   * The four movement actions are read as HELD on the `playing` screen, because
//     a held direction hops the critter repeatedly at the cadence
//     `specs/hopping.md` fixes. They are read as PRESS EDGES on every other
//     screen, where one press moves a menu's highlight one item.
//   * `confirm`, `back`, `pause` and `mute` are read as press edges everywhere,
//     because each fires once per press however long the key is held.
//
// A direction is therefore reported as `held || pressed`: a key still down at the
// frame reads as held, and a key pressed and released inside one frame reads as
// its edge, so a tap and a hold both produce exactly one hop and a hold repeats.
// Every edge is read here, whichever screen is showing, so none survives into the
// next frame and none can be consumed twice. That is what lets `Escape` drive both
// `pause` and `back`: both edges are armed, both are read, and the screen decides
// which one applies.
//
// THE POINTER IS READ HERE TOO, and it is the one part of the input that reaches
// the game without a registered action: `specs/controls.md` has a pointer and a
// touch contact drive the menus directly. The engine hands over every sample the
// frame collected, already in the game's own logical units, and this turns them
// into the two edges `specs/ui.md` decides a menu from — an AIM, which is a
// position the player is indicating, and a RELEASE, which carries both the point
// the press landed on and the point it lifted at, because a confirm is only a
// confirm when the two fall in one item's region.
//
// A MOUSE AIMS WHILE IT HOVERS AND A FINGER ONLY WHILE IT IS DOWN, which is the
// difference `specs/ui.md` draws between "a pointer moves onto an item's region"
// and "a touch contact lands inside an item's region, or travels onto one".

import { ACTIONS, BINDINGS, LAYOUT, type ActionName } from "./constants";
import type {
  InitApi,
  PointerSample,
  UpdateApi,
} from "@test-cabinet/simple-2d";

/** One thing a pointer or a touch contact did, in logical stage units. */
export interface PointerEdge {
  /** Whether the contact landed, moved, or lifted. */
  readonly kind: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
  /** Whether a finger drove it, which decides whether a move indicates at all. */
  readonly touch: boolean;
}

/** Everything a frame's input amounts to, resolved once per update. */
export interface FrameInput {
  /** The four directions, each held now or pressed since the last frame. */
  readonly up: boolean;
  readonly down: boolean;
  readonly left: boolean;
  readonly right: boolean;
  /** The same four as press edges alone, which is how a menu reads them. */
  readonly tapUp: boolean;
  readonly tapDown: boolean;
  readonly tapLeft: boolean;
  readonly tapRight: boolean;
  readonly confirm: boolean;
  readonly back: boolean;
  readonly pause: boolean;
  readonly mute: boolean;
  /**
   * The frame's pointer and touch edges, in the order the engine collected them
   * (`specs/ui.md`).
   */
  readonly pointer: readonly PointerEdge[];
}

/** A frame with no input at all: what a tick outside an update is stepped with. */
export const NO_INPUT: FrameInput = {
  up: false,
  down: false,
  left: false,
  right: false,
  tapUp: false,
  tapDown: false,
  tapLeft: false,
  tapRight: false,
  confirm: false,
  back: false,
  pause: false,
  mute: false,
  pointer: [],
};

/**
 * Register every action, bound to its keys.
 *
 * The layout's own vocabulary is checked against `ACTIONS` first, so an action the
 * layout speaks and this build forgot is a failure at start-up rather than a
 * control that silently does nothing.
 */
export function registerActions(api: Pick<InitApi, "input">): void {
  const layout = api.input.layout();
  if (layout === null) {
    throw new Error(`Floe: the engine was built without the ${LAYOUT} layout`);
  }
  if (layout.actions.join() !== ACTIONS.join()) {
    throw new Error(
      `Floe: the ${layout.name} layout speaks [${layout.actions.join(", ")}], ` +
        `but this build registers [${ACTIONS.join(", ")}]`,
    );
  }
  for (const action of ACTIONS) {
    api.input.register(action, { keys: [...BINDINGS[action]] });
  }
}

/** Whether the action's key is down at this frame. */
function held(api: UpdateApi, action: ActionName): boolean {
  return api.input.value(action) > 0;
}

/**
 * The frame's pointer samples, in the order the engine collected them.
 *
 * A straight translation: the engine has already mapped every sample into the
 * game's own logical units, so all this drops is the fields `specs/ui.md` has
 * nothing to say about. Which sample confirms is `src/screens.ts`'s to decide,
 * because that needs the press it is paired with, which is carried across frames
 * beside the rest of the gesture the player is part-way through.
 */
function pointerEdges(samples: readonly PointerSample[]): PointerEdge[] {
  return samples.map((sample) => ({
    kind: sample.type,
    x: sample.x,
    y: sample.y,
    touch: sample.device === "touch",
  }));
}

/** Read the whole of this frame's input, consuming every edge exactly once. */
export function readInput(api: UpdateApi): FrameInput {
  const tapUp = api.input.pressed("up");
  const tapDown = api.input.pressed("down");
  const tapLeft = api.input.pressed("left");
  const tapRight = api.input.pressed("right");

  return {
    up: held(api, "up") || tapUp,
    down: held(api, "down") || tapDown,
    left: held(api, "left") || tapLeft,
    right: held(api, "right") || tapRight,
    tapUp,
    tapDown,
    tapLeft,
    tapRight,
    confirm: api.input.pressed("confirm"),
    back: api.input.pressed("back"),
    pause: api.input.pressed("pause"),
    mute: api.input.pressed("mute"),
    pointer: pointerEdges(api.input.pointerSamples()),
  };
}
