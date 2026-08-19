// Carom — input, as engine actions.
//
// The game never sees a KeyboardEvent. It declares NAMED ACTIONS with the keys
// that drive them, and the engine does the listening, the edge detection and the
// binding. Two consequences shape this file:
//
//   * Every read below goes through `engine.input`. A held read (`value`) is what
//     drives continuous paddle motion; an edge read (`pressed`) is what drives a
//     menu move, a confirm, a pause or a mute, exactly once per press.
//   * An edge is consumed by the first call that sees it and discarded at the end
//     of the frame it was armed in. So each edge is read in exactly ONE place per
//     frame — `Game.handleInput` — and the reads below are worded to make that
//     obvious.
//
// The action names are not free: they are the `dual-vertical` touch layout's
// vocabulary (`p1-up`, `p1-down`, `p2-up`, `p2-down`) plus the menu vocabulary
// every layout carries (`confirm`, `back`, `pause`, `mute`). Registering exactly
// that set, in the layout's own order, is what lets the engine tag each action
// with the layout and lets a driver confirm the bindings without pressing a key.
// The keys they are bound to are the ones specs/modes/single-player.md and
// specs/modes/versus.md name.

import { TOUCH_LAYOUTS } from "@test-cabinet/simple-2d";
import type { Engine } from "@test-cabinet/simple-2d";
import { clamp } from "./entities";

/** Carom is two paddles facing each other: one vertical slider per side. */
export const LAYOUT = "dual-vertical";

// The keys each action is bound to, as `KeyboardEvent.code` values so the binding
// is a physical key rather than a layout-dependent character.
//
// `Escape` deliberately drives TWO actions: `pause` and `back`. That is one key
// meaning "get me out of here", which is a pause during a match and a step back on
// a menu — and the engine allows one key to raise several actions precisely so a
// game can make that distinction itself. `Game.handleInput` reads whichever of the
// two the current screen calls for.
export const BINDINGS: Readonly<Record<string, string[]>> = {
  "p1-up": ["KeyW"],
  "p1-down": ["KeyS"],
  "p2-up": ["ArrowUp"],
  "p2-down": ["ArrowDown"],
  confirm: ["Enter", "Space"],
  back: ["Escape"],
  pause: ["KeyP", "Escape"],
  mute: ["KeyM"],
};

/**
 * Register every action of the selected layout, bound to its keys.
 *
 * Iterating the layout's own vocabulary rather than the table above is what makes
 * this total: an action the layout speaks and Carom forgot to bind is a hard
 * failure at start-up, not a control that silently does nothing.
 */
export function registerActions(engine: Engine): void {
  for (const action of TOUCH_LAYOUTS[LAYOUT].actions) {
    const keys = BINDINGS[action];
    if (!keys) {
      throw new Error(
        `Carom: the "${action}" action of the ${LAYOUT} layout has no key binding`,
      );
    }
    engine.input.register(action, { keys });
  }
}

/**
 * Carom's semantic reads over the registered actions.
 *
 * The held reads return a direction in `[-1, 1]` (negative is up, matching the
 * y-down coordinate system), which the caller scales by the paddle speed and the
 * frame's delta time. The edge reads are one-shot and are each called once per
 * frame.
 */
export class Controls {
  constructor(private readonly engine: Engine) {}

  // ---- Held reads (continuous motion) ----------------------------------

  /** Player one's slider: the left paddle in Versus, the human's in Solo. */
  p1Axis(): number {
    return this.axis("p1-up", "p1-down");
  }

  /** Player two's slider: the right paddle in Versus. */
  p2Axis(): number {
    return this.axis("p2-up", "p2-down");
  }

  /**
   * Solo has no player two, so both sliders drive the one human paddle — which is
   * what makes `W`/`S` and `Up`/`Down` interchangeable there
   * (specs/modes/single-player.md). Summing and clamping keeps opposite inputs
   * cancelling, so holding up on one side and down on the other stands still.
   */
  soloAxis(): number {
    return clamp(this.p1Axis() + this.p2Axis(), -1, 1);
  }

  private axis(up: string, down: string): number {
    return this.engine.input.value(down) - this.engine.input.value(up);
  }

  // ---- Edge reads (one-shot) -------------------------------------------

  /** Either side's up action moves a menu selection up. */
  menuUp(): boolean {
    // Both are read, never short-circuited: an edge left unconsumed here would be
    // discarded at the end of the frame anyway, and reading both keeps this frame's
    // input fully accounted for.
    const p1 = this.engine.input.pressed("p1-up");
    const p2 = this.engine.input.pressed("p2-up");
    return p1 || p2;
  }

  /** Either side's down action moves a menu selection down. */
  menuDown(): boolean {
    const p1 = this.engine.input.pressed("p1-down");
    const p2 = this.engine.input.pressed("p2-down");
    return p1 || p2;
  }

  confirm(): boolean {
    return this.engine.input.pressed("confirm");
  }

  back(): boolean {
    return this.engine.input.pressed("back");
  }

  pause(): boolean {
    return this.engine.input.pressed("pause");
  }

  mute(): boolean {
    return this.engine.input.pressed("mute");
  }
}
