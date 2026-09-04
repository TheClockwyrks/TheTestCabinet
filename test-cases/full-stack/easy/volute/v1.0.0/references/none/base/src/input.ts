// Volute — the keyboard and the pointer, as named actions (specs/controls.md).
//
// The game never sees a `KeyboardEvent` or a `MouseEvent`. It registers an action
// name against the `KeyboardEvent.code` values that drive it — physical keys, so a
// binding survives a non-QWERTY layout — and then asks two questions:
//
//   * `value(name)` — is it held right now? What swings the aim.
//   * `pressed(name)` — did it go down since the last read? An edge, and the unit a
//     shot, a swap, a confirm, a pause or a mute is counted in.
//
// An edge is armed when the action leaves rest, CONSUMED by the first `pressed`
// that sees it, and discarded at the end of a frame that actually ran a tick.
// Consuming is what stops one press being acted on twice; the discard is what
// stops a press that nothing read surfacing later, out of order. A frame that ran
// no tick keeps its edges, so a shot raised in the sliver between two ticks is
// still fired.
//
// The two mouse buttons are two more sources on two existing actions: the primary
// raises `fire`, the secondary raises `swap`, and the secondary is consumed so the
// browser's context menu stays closed.

/** The pseudo-code the primary mouse button is registered under. */
export const MOUSE_PRIMARY = "MousePrimary";
/** The pseudo-code the secondary mouse button is registered under. */
export const MOUSE_SECONDARY = "MouseSecondary";

/** The mutable state behind one registered action. */
interface Action {
  readonly name: string;
  /** The bound codes currently down: held until the last of them comes up. */
  readonly held: Set<string>;
  /** An armed edge, waiting to be consumed or dropped at the end of a frame. */
  edge: boolean;
}

/**
 * Narrows an `Event` to a `KeyboardEvent` structurally rather than with
 * `instanceof`, so an event dispatched from another realm — which is what a test
 * and a browser automation driver both dispatch — still reaches an action.
 */
export function asKeyboardEvent(event: Event): KeyboardEvent | null {
  const candidate = event as Partial<KeyboardEvent>;
  return typeof candidate.code === "string" ? (event as KeyboardEvent) : null;
}

/** Where a pointer event's page position is turned into the field's own units. */
export type PointerMap = (
  clientX: number,
  clientY: number,
) => { x: number; y: number } | null;

/** The registry: the single answer to "is the player doing X?". */
export class Controls {
  private readonly keyTarget: EventTarget;
  private readonly pointerTarget: EventTarget;
  private readonly map: PointerMap;
  private readonly actions = new Map<string, Action>();
  /** Reverse index from key code to the actions it drives, rebuilt on register. */
  private readonly byCode = new Map<string, string[]>();
  private pointerAt: { x: number; y: number } | null = null;
  private pointerFresh = false;
  private detached = false;

  private readonly onKeyDown = (event: Event): void => {
    const key = asKeyboardEvent(event);
    // An OS auto-repeat is not a new press: the key never came up.
    if (key === null || key.repeat) return;
    this.press(key.code);
  };

  private readonly onKeyUp = (event: Event): void => {
    const key = asKeyboardEvent(event);
    if (key === null) return;
    this.release(key.code);
  };

  private readonly onPointerMove = (event: Event): void => {
    this.trackPointer(event);
  };

  private readonly onPointerDown = (event: Event): void => {
    this.trackPointer(event);
    const button = (event as Partial<MouseEvent>).button;
    if (button === 0) this.press(MOUSE_PRIMARY);
    else if (button === 2) this.press(MOUSE_SECONDARY);
  };

  private readonly onPointerUp = (event: Event): void => {
    const button = (event as Partial<MouseEvent>).button;
    if (button === 0) this.release(MOUSE_PRIMARY);
    else if (button === 2) this.release(MOUSE_SECONDARY);
  };

  /** The field answers a secondary press as a control, so no menu opens over it. */
  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  constructor(
    keyTarget: EventTarget,
    pointerTarget: EventTarget,
    map: PointerMap,
  ) {
    this.keyTarget = keyTarget;
    this.pointerTarget = pointerTarget;
    this.map = map;
    this.keyTarget.addEventListener("keydown", this.onKeyDown);
    this.keyTarget.addEventListener("keyup", this.onKeyUp);
    this.pointerTarget.addEventListener("pointermove", this.onPointerMove);
    this.pointerTarget.addEventListener("pointerdown", this.onPointerDown);
    this.pointerTarget.addEventListener("pointerup", this.onPointerUp);
    this.pointerTarget.addEventListener("mousemove", this.onPointerMove);
    this.pointerTarget.addEventListener("mousedown", this.onPointerDown);
    this.pointerTarget.addEventListener("mouseup", this.onPointerUp);
    this.pointerTarget.addEventListener("contextmenu", this.onContextMenu);
  }

  /**
   * Register, or re-register, `name` against `codes`.
   *
   * A re-registration replaces the binding wholesale and returns the action to
   * rest, because carrying held state across a rebind would strand an action on
   * with no key-up able to lower it.
   */
  register(name: string, codes: readonly string[]): void {
    this.actions.set(name, { name, held: new Set(), edge: false });
    for (const code of codes) {
      const names = this.byCode.get(code);
      if (names === undefined) this.byCode.set(code, [name]);
      else if (!names.includes(name)) names.push(name);
    }
  }

  /**
   * Whether the action is held, as `1` or `0`.
   *
   * An unregistered name reads `0` rather than throwing: a caller probing for an
   * action discovers it is missing without taking the page down mid-frame.
   */
  value(name: string): number {
    return (this.actions.get(name)?.held.size ?? 0) > 0 ? 1 : 0;
  }

  /** Whether the action went down since the last read. Consumes the edge. */
  pressed(name: string): boolean {
    const action = this.actions.get(name);
    if (action === undefined || !action.edge) return false;
    action.edge = false;
    return true;
  }

  /**
   * The pointer position delivered since the last read, in logical units, or
   * `null` when none was.
   *
   * Reading it consumes the delivery, so a pointer that has not moved leaves the
   * aim to the turn actions.
   */
  pointer(): { x: number; y: number } | null {
    if (!this.pointerFresh) return null;
    this.pointerFresh = false;
    return this.pointerAt;
  }

  /** Discard every edge nothing consumed: a press is news for one frame only. */
  endFrame(): void {
    for (const action of this.actions.values()) action.edge = false;
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.keyTarget.removeEventListener("keydown", this.onKeyDown);
    this.keyTarget.removeEventListener("keyup", this.onKeyUp);
    this.pointerTarget.removeEventListener("pointermove", this.onPointerMove);
    this.pointerTarget.removeEventListener("pointerdown", this.onPointerDown);
    this.pointerTarget.removeEventListener("pointerup", this.onPointerUp);
    this.pointerTarget.removeEventListener("mousemove", this.onPointerMove);
    this.pointerTarget.removeEventListener("mousedown", this.onPointerDown);
    this.pointerTarget.removeEventListener("mouseup", this.onPointerUp);
    this.pointerTarget.removeEventListener("contextmenu", this.onContextMenu);
  }

  private press(code: string): void {
    for (const action of this.actionsFor(code)) {
      const wasHeld = action.held.size > 0;
      action.held.add(code);
      if (!wasHeld) action.edge = true;
    }
  }

  private release(code: string): void {
    for (const action of this.actionsFor(code)) action.held.delete(code);
  }

  private trackPointer(event: Event): void {
    const mouse = event as Partial<MouseEvent>;
    if (
      typeof mouse.clientX !== "number" ||
      typeof mouse.clientY !== "number"
    ) {
      return;
    }
    const point = this.map(mouse.clientX, mouse.clientY);
    if (point === null) return;
    this.pointerAt = point;
    this.pointerFresh = true;
  }

  /** The actions bound to `code`; a code nothing is bound to resolves to none. */
  private actionsFor(code: string): Action[] {
    const found: Action[] = [];
    for (const name of this.byCode.get(code) ?? []) {
      const action = this.actions.get(name);
      if (action !== undefined) found.push(action);
    }
    return found;
  }
}
