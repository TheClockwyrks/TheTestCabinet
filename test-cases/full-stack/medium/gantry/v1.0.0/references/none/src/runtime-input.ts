// The keyboard and the pointer, as the game reads them.
//
// `specs/controls.md` binds each action in `ACTIONS` to one or more
// `KeyboardEvent.code` values in `BINDINGS`. This tracker turns raw key and
// pointer acts into what a frame consumes: the press edges gathered since the
// last frame, whether an action is held right now, the pointer's acts in the
// order they arrived, and its current position in logical stage units.
//
// It knows nothing of the DOM: both the browser's listeners and the debug
// surface's input operations (`specs/instrumentation.md`) drive it through the
// same calls, so a posed press and a player's press are the same event.

import { ACTIONS, BINDINGS, type ActionName } from "./constants";
import type { InputFrame, StagePointerEvent } from "./runtime";

/** `BINDINGS` read the other way round: which actions a key code fires. */
const ACTIONS_BY_CODE: ReadonlyMap<string, readonly ActionName[]> = (() => {
  const index = new Map<string, ActionName[]>();
  for (const action of ACTIONS) {
    for (const code of BINDINGS[action]) {
      const bound = index.get(code);
      if (bound === undefined) index.set(code, [action]);
      else bound.push(action);
    }
  }
  return index;
})();

/** The actions a key code fires, in `ACTIONS` order. Empty if it is unbound. */
export function actionsForCode(code: string): readonly ActionName[] {
  return ACTIONS_BY_CODE.get(code) ?? [];
}

/** Whether a key code fires any registered action. */
export function isBoundCode(code: string): boolean {
  return ACTIONS_BY_CODE.has(code);
}

/**
 * The keys held and the acts gathered since the frame last took them.
 *
 * A key going down fires the press edge of every action it is bound to; an
 * action counts as held while any of its keys is down, so two keys bound to one
 * action do not release it early. Each call to `keyDown` delivers one press:
 * the browser's auto-repeat is filtered by the listener that feeds this, which
 * is where the browser's notion of a repeat lives.
 */
export class InputTracker {
  private readonly downCodes = new Set<string>();
  private pressed: ActionName[] = [];
  private pointerActs: StagePointerEvent[] = [];
  private x = 0;
  private y = 0;
  private pressLive = false;
  private contactX = 0;
  private contactY = 0;

  /** Take and clear what has arrived since the last call. */
  take(): InputFrame {
    const frame: InputFrame = {
      actions: this.pressed,
      pointer: this.pointerActs,
    };
    this.pressed = [];
    this.pointerActs = [];
    return frame;
  }

  /** Whether any key bound to the action is down right now. */
  held(action: ActionName): boolean {
    return BINDINGS[action].some((code) => this.downCodes.has(code));
  }

  /** The pointer's current position, in logical stage units. */
  pointerX(): number {
    return this.x;
  }

  pointerY(): number {
    return this.y;
  }

  keyDown(code: string): void {
    this.downCodes.add(code);
    for (const action of actionsForCode(code)) this.pressed.push(action);
  }

  keyUp(code: string): void {
    this.downCodes.delete(code);
  }

  /** Whether a press is live, which is what a stray release is judged by. */
  pointerDownNow(): boolean {
    return this.pressLive;
  }

  pointerMove(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.pointerActs.push({ kind: "move", x, y });
  }

  /** A press moves the pointer there first, so it needs no move before it. */
  pointerDown(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.pressLive = true;
    this.pointerActs.push({ kind: "down", x, y });
  }

  pointerUp(): void {
    this.pressLive = false;
    this.pointerActs.push({ kind: "up", x: this.x, y: this.y });
  }

  /**
   * A touch contact landing. It is not the pointer: the pointer position and
   * the live press are left exactly as they stand (`specs/controls.md`), and
   * only where the contact landed is remembered, for the lift.
   */
  touchDown(x: number, y: number): void {
    this.contactX = x;
    this.contactY = y;
    this.pointerActs.push({ kind: "touch-down", x, y });
  }

  /** The contact lifting, at the position it landed at. */
  touchUp(): void {
    this.pointerActs.push({
      kind: "touch-up",
      x: this.contactX,
      y: this.contactY,
    });
  }
}
