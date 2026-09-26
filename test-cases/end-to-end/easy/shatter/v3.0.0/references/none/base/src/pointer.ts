// Shatter — the mouse and the touch contacts, as samples in field coordinates.
//
// This build stands on no engine, so the pointer belongs to the runtime layer
// beside the keyboard (`specs/controls.md`). It does the same job `keyboard.ts`
// does for keys: listen to the page, and hand the game one plain reading per
// frame that carries no DOM at all.
//
// WHAT A SAMPLE IS. One `pointerdown`, `pointermove` or `pointerup`, with its
// position taken through the same letterboxed fit the game draws under, so a
// position the game reads and a region `menus.ts` reports lie in ONE coordinate
// space. A mouse, a pen and a finger arrive on the same three events and are not
// told apart, because `specs/ui.md` gives them the same effects.
//
// SAMPLES ARE KEPT IN ARRIVAL ORDER, not collapsed to the frame's last position:
// a sweep that crossed three menu entries between two frames visited them in an
// order, and the entry it came to rest on is the one it ends on. The list is
// drained at the end of every frame, exactly as an unread key edge is, so a
// sample never surfaces a frame late.
//
// A CONTACT'S ID IS CARRIED THROUGH. A confirm needs a press and its release to
// be the same finger (`specs/ui.md`), and the id is what says so.

/** One raw pointer event, in the logical units of the field. */
export interface PointerSample {
  /** Which of the three edges this is. */
  readonly type: "down" | "move" | "up";
  /** Where it landed, in logical field units. */
  readonly x: number;
  readonly y: number;
  /** The pointer it belongs to: a mouse keeps one, each contact gets its own. */
  readonly id: number;
}

/** Where a point in CSS client coordinates lands in logical field units. */
export type ClientToField = (
  clientX: number,
  clientY: number,
) => { x: number; y: number };

/**
 * Narrows an `Event` to a `PointerEvent` structurally rather than with
 * `instanceof`, for the reason `asKeyboardEvent` does: an event dispatched from
 * another realm, or a plain `Event` carrying the three fields read here, still
 * has to reach the game.
 */
function asPointerEvent(
  event: Event,
): { clientX: number; clientY: number; pointerId: number } | null {
  const candidate = event as Partial<PointerEvent>;
  if (
    typeof candidate.clientX !== "number" ||
    typeof candidate.clientY !== "number"
  ) {
    return null;
  }
  return {
    clientX: candidate.clientX,
    clientY: candidate.clientY,
    pointerId:
      typeof candidate.pointerId === "number" ? candidate.pointerId : 1,
  };
}

/** The frame's pointer samples, gathered off the page. */
export class Pointer {
  private readonly target: EventTarget;
  private readonly toField: ClientToField;
  private frame: PointerSample[] = [];
  private detached = false;

  private readonly record = (type: PointerSample["type"]) => {
    return (event: Event): void => {
      const raw = asPointerEvent(event);
      if (raw === null) return;
      const point = this.toField(raw.clientX, raw.clientY);
      this.frame.push({ type, x: point.x, y: point.y, id: raw.pointerId });
    };
  };

  private readonly onDown = this.record("down");
  private readonly onMove = this.record("move");
  private readonly onUp = this.record("up");

  constructor(target: EventTarget, toField: ClientToField) {
    this.target = target;
    this.toField = toField;
    this.target.addEventListener("pointerdown", this.onDown);
    this.target.addEventListener("pointermove", this.onMove);
    this.target.addEventListener("pointerup", this.onUp);
  }

  /** Every sample this frame has gathered, oldest first. */
  samples(): readonly PointerSample[] {
    return this.frame;
  }

  /** Drop the frame's samples: a sample is news for one frame only. */
  endFrame(): void {
    if (this.frame.length > 0) this.frame = [];
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("pointerdown", this.onDown);
    this.target.removeEventListener("pointermove", this.onMove);
    this.target.removeEventListener("pointerup", this.onUp);
  }
}
