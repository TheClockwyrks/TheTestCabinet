// Carom — the pointer and the touch contacts, as the runtime delivers them.
//
// The menus take a mouse and a finger as well as the keyboard (`specs/ui.md`),
// and this build stands on no engine, so the layer that hears a real
// `pointermove` and a real `touchstart` is part of it. This module is that layer.
// It does three things and nothing else:
//
//   * It LISTENS. Mouse and pen arrive as pointer events; a finger arrives as
//     touch events, so a browser that sends compatibility mouse events after a
//     tap cannot make one contact look like two. Pointer events whose
//     `pointerType` is `touch` are therefore ignored: the touch listeners already
//     have that contact.
//   * It MAPS. Every position is converted to the field's logical units through
//     the same letterboxed fit the game draws under, so a position the game reads
//     and a region the game reports lie in one coordinate space
//     (`specs/overview.md`).
//   * It QUEUES. Samples accumulate between frames and are drained once per
//     frame, in arrival order, by the game's own input read. A press and the
//     release that follows it may therefore arrive on one frame, which is
//     precisely the case `specs/ui.md` says that frame confirms on.
//
// WHAT IT DOES NOT DO is decide anything. Which item a position is over, whether
// a gesture confirms, and what a confirm means are the game's
// (`src/game.ts` over `src/menu.ts`) — this file only reports where the hand was
// and what it did. That is why an `up` sample carries the point its press landed
// on: the pairing is a fact about the gesture, and it is the whole of what the
// game needs to tell a click from a slide-off.

/** Where a sample came from. The two are read alike and tracked apart. */
export type PointerSource = "mouse" | "touch";

/** What the hand did. A finger has no hover, so it raises no `move` unpressed. */
export type PointerPhase = "move" | "down" | "up";

/** One thing the hand did, in the field's logical units. */
export interface PointerSample {
  readonly source: PointerSource;
  readonly phase: PointerPhase;
  /** Where it happened, in logical units. */
  readonly x: number;
  readonly y: number;
  /**
   * On an `up`, where that gesture's press landed; `null` on the other two
   * phases and on a release with no press behind it.
   */
  readonly from: { readonly x: number; readonly y: number } | null;
}

/** A point in the field's logical units. */
interface Point {
  x: number;
  y: number;
}

/**
 * The cap on samples held between two frames.
 *
 * The queue is drained every frame the game runs, but a game taken off its clock
 * keeps presenting without updating, and a hand moved across the window in that
 * time would otherwise accumulate without bound. The oldest are dropped, because
 * the newest are the ones a menu acts on.
 */
const MAX_QUEUED = 256;

/** Maps a client position (CSS pixels, page space) into logical field units. */
export type ClientToLogical = (clientX: number, clientY: number) => Point;

/** A position read structurally off an event, so a synthetic one still lands. */
function clientPoint(candidate: unknown): Point | null {
  const source = candidate as { clientX?: unknown; clientY?: unknown } | null;
  if (source === null || source === undefined) return null;
  const { clientX, clientY } = source;
  if (typeof clientX !== "number" || typeof clientY !== "number") return null;
  return { x: clientX, y: clientY };
}

/** The first changed contact of a touch event, read structurally. */
function touchPoint(event: Event): Point | null {
  const candidate = event as unknown as {
    changedTouches?: ArrayLike<unknown>;
    touches?: ArrayLike<unknown>;
  };
  const list = candidate.changedTouches ?? candidate.touches;
  if (list === undefined || list.length === 0) return null;
  return clientPoint(list[0]);
}

/** Whether a pointer event describes a finger, which the touch listeners own. */
function isTouchPointer(event: Event): boolean {
  return (
    (event as unknown as { pointerType?: unknown }).pointerType === "touch"
  );
}

/**
 * The hand, as one queue of samples.
 *
 * One mouse and one contact are all a vertical menu needs, so each source keeps
 * a single press. A press that never sees its release — a pointer that left the
 * window, a contact the browser cancelled — is dropped rather than left armed, so
 * the next release cannot pair with it.
 */
export class Pointing {
  private readonly target: EventTarget;
  private readonly toLogical: ClientToLogical;
  private readonly queue: PointerSample[] = [];

  /** Where each source's press landed, in logical units, while it is held. */
  private mousePress: Point | null = null;
  private touchPress: Point | null = null;
  /** The contact's most recent position: what a lift with no coordinates is at. */
  private touchAt: Point | null = null;
  private detached = false;

  private readonly onPointerDown = (event: Event): void => {
    if (isTouchPointer(event)) return;
    const at = this.logical(clientPoint(event));
    if (at === null) return;
    this.mousePress = at;
    this.push({ source: "mouse", phase: "down", x: at.x, y: at.y, from: null });
  };

  private readonly onPointerMove = (event: Event): void => {
    if (isTouchPointer(event)) return;
    const at = this.logical(clientPoint(event));
    if (at === null) return;
    this.push({ source: "mouse", phase: "move", x: at.x, y: at.y, from: null });
  };

  private readonly onPointerUp = (event: Event): void => {
    if (isTouchPointer(event)) return;
    const at = this.logical(clientPoint(event));
    const from = this.mousePress;
    this.mousePress = null;
    if (at === null) return;
    this.push({ source: "mouse", phase: "up", x: at.x, y: at.y, from });
  };

  private readonly onPointerCancel = (event: Event): void => {
    if (isTouchPointer(event)) return;
    this.mousePress = null;
  };

  private readonly onTouchStart = (event: Event): void => {
    // A contact the game has taken is not the page's to scroll or to replay as a
    // mouse click: preventing the default is what stops one tap arriving twice.
    preventDefault(event);
    const at = this.logical(touchPoint(event));
    if (at === null) return;
    this.touchPress = at;
    this.touchAt = at;
    this.push({ source: "touch", phase: "down", x: at.x, y: at.y, from: null });
  };

  private readonly onTouchMove = (event: Event): void => {
    preventDefault(event);
    const at = this.logical(touchPoint(event));
    if (at === null) return;
    this.touchAt = at;
    this.push({ source: "touch", phase: "move", x: at.x, y: at.y, from: null });
  };

  private readonly onTouchEnd = (event: Event): void => {
    preventDefault(event);
    // A lift often carries no coordinates of its own, so the contact's last
    // known position is where it lifted.
    const at = this.logical(touchPoint(event)) ?? this.touchAt;
    const from = this.touchPress;
    this.touchPress = null;
    this.touchAt = null;
    if (at === null) return;
    this.push({ source: "touch", phase: "up", x: at.x, y: at.y, from });
  };

  private readonly onTouchCancel = (): void => {
    this.touchPress = null;
    this.touchAt = null;
  };

  constructor(target: EventTarget, toLogical: ClientToLogical) {
    this.target = target;
    this.toLogical = toLogical;
    target.addEventListener("pointerdown", this.onPointerDown);
    target.addEventListener("pointermove", this.onPointerMove);
    target.addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("pointercancel", this.onPointerCancel);
    // Non-passive, because each of the three prevents the page's default.
    const active = { passive: false } as const;
    target.addEventListener("touchstart", this.onTouchStart, active);
    target.addEventListener("touchmove", this.onTouchMove, active);
    target.addEventListener("touchend", this.onTouchEnd, active);
    target.addEventListener("touchcancel", this.onTouchCancel);
  }

  /** Every sample since the last drain, in arrival order. Empties the queue. */
  take(): PointerSample[] {
    if (this.queue.length === 0) return [];
    return this.queue.splice(0, this.queue.length);
  }

  /** Discard whatever is queued, without acting on it. */
  clear(): void {
    this.queue.length = 0;
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    this.target.removeEventListener("pointermove", this.onPointerMove);
    this.target.removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("pointercancel", this.onPointerCancel);
    this.target.removeEventListener("touchstart", this.onTouchStart);
    this.target.removeEventListener("touchmove", this.onTouchMove);
    this.target.removeEventListener("touchend", this.onTouchEnd);
    this.target.removeEventListener("touchcancel", this.onTouchCancel);
  }

  /** A client position in logical units, or `null` where there is no position. */
  private logical(at: Point | null): Point | null {
    if (at === null) return null;
    const mapped = this.toLogical(at.x, at.y);
    return Number.isFinite(mapped.x) && Number.isFinite(mapped.y)
      ? mapped
      : null;
  }

  private push(sample: PointerSample): void {
    this.queue.push(sample);
    if (this.queue.length > MAX_QUEUED) {
      this.queue.splice(0, this.queue.length - MAX_QUEUED);
    }
  }
}

/** Prevent an event's default where the environment offers one to prevent. */
function preventDefault(event: Event): void {
  if (
    typeof event.preventDefault === "function" &&
    event.cancelable !== false
  ) {
    event.preventDefault();
  }
}
