// Wireworm — the pointer and the finger, as one per-frame report.
//
// The menus take a mouse and touch as well as the keyboard (`specs/ui.md`), and
// this build stands on no engine, so reading the device is the runtime layer's
// work exactly as reading the keyboard is. The game never sees a `PointerEvent`:
// it asks, once per frame, what the pointer did — where it moved to, where a
// press landed, and which press came up where — and the answers arrive in the
// stage's own logical units, taken through the same letterboxed fit the game
// draws under.
//
// ONE STREAM FOR BOTH DEVICES. A mouse and a finger reach the page as the same
// pointer events, told apart by `pointerType`, and the menus treat them almost
// alike: a move selects, a press selects, and a press and its release inside one
// region confirm. A finger simply never hovers, so its first event is the
// landing, which is why a press selects as well as a move does and why nothing
// here needs to know which device it is reading.
//
// LISTENING TO POINTER EVENTS RATHER THAN MOUSE AND TOUCH EVENTS is what keeps
// that true. A browser follows a touch with a set of compatibility mouse events,
// so a layer listening to both would see one tap twice; pointer events are the
// single stream both devices are delivered on.
//
// AN EDGE IS NEWS FOR ONE FRAME. What moved, what was pressed and what was
// released are cleared at the end of every frame that ran, so a gesture is acted
// on once. The press itself is not an edge: it is held until it comes up,
// because a confirm requires both of its edges inside one region and they may be
// frames apart.

/** A position in the stage's logical units. */
export interface PointerPoint {
  x: number;
  y: number;
}

/** What the pointer and the touch contacts did over one frame. */
export interface PointerFrame {
  /** Where the pointer moved to, or `null` if it did not move. */
  moved: PointerPoint | null;
  /** Where a press landed, or `null` if none did. */
  pressed: PointerPoint | null;
  /** A completed press: where it went down, and where it came up. */
  released: { from: PointerPoint; to: PointerPoint } | null;
}

/** A frame on which the pointer did nothing at all. */
export const IDLE_POINTER: PointerFrame = {
  moved: null,
  pressed: null,
  released: null,
};

/** A position in CSS pixels, as an event reports it. */
interface RawPoint {
  x: number;
  y: number;
}

/**
 * The map from a CSS-pixel page position to a logical one, supplied per frame
 * because the fit is re-derived every frame.
 *
 * A degenerate fit — a canvas the page has not laid out yet — maps to `null`,
 * and a frame whose points do not map reports nothing rather than a position at
 * the origin.
 */
export type PointerMap = (x: number, y: number) => PointerPoint | null;

/**
 * Narrows an `Event` to a `PointerEvent` structurally rather than with
 * `instanceof`, so an event dispatched from another realm still arrives.
 */
export function asPointerEvent(event: Event): PointerEvent | null {
  const candidate = event as Partial<PointerEvent>;
  return typeof candidate.clientX === "number" &&
    typeof candidate.clientY === "number"
    ? (event as PointerEvent)
    : null;
}

/** The pointer, as the runtime holds it. */
export class PointerInput {
  private readonly target: EventTarget;
  /** The last position each live pointer was seen at, by `pointerId`. */
  private readonly seen = new Map<number, RawPoint>();
  private pressId: number | null = null;
  private pressFrom: RawPoint | null = null;

  private movedRaw: RawPoint | null = null;
  private pressedRaw: RawPoint | null = null;
  private releasedRaw: { from: RawPoint; to: RawPoint } | null = null;
  private detached = false;

  private readonly onDown = (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    const at = { x: pointer.clientX, y: pointer.clientY };
    this.seen.set(pointer.pointerId, at);
    this.pressId = pointer.pointerId;
    this.pressFrom = at;
    this.pressedRaw = at;
  };

  private readonly onMove = (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    const at = { x: pointer.clientX, y: pointer.clientY };
    this.seen.set(pointer.pointerId, at);
    this.movedRaw = at;
  };

  private readonly onUp = (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    // A finger's lift carries no useful position of its own on every browser, so
    // the contact's last KNOWN position is where the release happened. For a
    // mouse that is the same point, since a mouse that moved before it came up
    // moved through a `pointermove` first.
    const to = this.seen.get(pointer.pointerId) ?? {
      x: pointer.clientX,
      y: pointer.clientY,
    };
    this.seen.delete(pointer.pointerId);
    if (this.pressId !== pointer.pointerId || this.pressFrom === null) return;
    this.releasedRaw = { from: this.pressFrom, to };
    this.pressId = null;
    this.pressFrom = null;
  };

  private readonly onCancel = (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    this.seen.delete(pointer.pointerId);
    if (this.pressId === pointer.pointerId) this.forget();
  };

  constructor(target: EventTarget) {
    this.target = target;
    this.target.addEventListener("pointerdown", this.onDown);
    this.target.addEventListener("pointermove", this.onMove);
    this.target.addEventListener("pointerup", this.onUp);
    this.target.addEventListener("pointercancel", this.onCancel);
  }

  /** What the pointer did this frame, in logical units. */
  frame(map: PointerMap): PointerFrame {
    const at = (raw: RawPoint | null): PointerPoint | null =>
      raw === null ? null : map(raw.x, raw.y);
    const from = at(this.releasedRaw?.from ?? null);
    const to = at(this.releasedRaw?.to ?? null);
    return {
      moved: at(this.movedRaw),
      pressed: at(this.pressedRaw),
      released: from === null || to === null ? null : { from, to },
    };
  }

  /** Discard this frame's edges. The press in progress, if any, is kept. */
  endFrame(): void {
    this.movedRaw = null;
    this.pressedRaw = null;
    this.releasedRaw = null;
  }

  /**
   * Forget the press in progress, so a gesture cannot span a change of screen.
   *
   * What the game calls when a frame's keyboard input moved it to another
   * screen: the release still to come belongs to a menu that is no longer shown,
   * and a confirm requires both of its edges on one menu.
   */
  forget(): void {
    this.pressId = null;
    this.pressFrom = null;
    this.releasedRaw = null;
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("pointerdown", this.onDown);
    this.target.removeEventListener("pointermove", this.onMove);
    this.target.removeEventListener("pointerup", this.onUp);
    this.target.removeEventListener("pointercancel", this.onCancel);
  }
}
