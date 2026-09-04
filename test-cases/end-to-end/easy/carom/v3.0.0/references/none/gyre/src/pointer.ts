// Carom — the mouse and the finger, as per-frame samples in logical units.
//
// The game never sees a `PointerEvent`, for the same reason it never sees a
// `KeyboardEvent`: what it needs is "where did the pointer go this frame, and did
// it press or release", already mapped through the letterboxed fit the game draws
// under (specs/overview.md). This module listens, maps, and buffers; the menus in
// `src/game.ts` decide what a sample means.
//
// ONE EVENT FAMILY, TWO DEVICES. Pointer events cover the mouse and the finger
// alike, and `pointerType` is what tells them apart — which matters, because
// `specs/ui.md` gives them different powers: a mouse HOVERS, so moving onto an
// item selects it with no button down, while a finger only exists between its
// landing and its lift. Both select, and both confirm when their two edges fall
// inside one item's region.
//
// A LIFT HAS NO PLACE OF ITS OWN. A touch is released with no coordinates — the
// contact is simply gone — so the lift is resolved at the last place the contact
// was seen, which this module tracks. A mouse release carries the position it was
// released at, which is the same thing said a different way.
//
// SAMPLES ARE NEWS FOR ONE FRAME. They are buffered as they arrive, read once by
// the update that follows, and discarded at the end of that frame — exactly as
// the keyboard's edges are, and for the same reason: what a driven scenario sees
// must not depend on how many times the browser happened to repaint.

/** Which device raised a sample. */
export type PointerKind = "mouse" | "touch";

/** What the device did. */
export type PointerPhase = "move" | "down" | "up";

/** One thing a pointer did, in the field's logical units. */
export interface PointerSample {
  readonly kind: PointerKind;
  readonly phase: PointerPhase;
  readonly x: number;
  readonly y: number;
}

/** A point in the page's CSS pixels, mapped into the field's logical units. */
export type PointerMapping = (
  clientX: number,
  clientY: number,
) => {
  x: number;
  y: number;
};

/** The shape this module reads off an event, whatever realm it was made in. */
interface PointerLike {
  type: string;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
}

/**
 * Narrows an `Event` to something carrying a pointer position, structurally
 * rather than with `instanceof`, so an event dispatched from another realm — or
 * a plain `Event` carrying the three fields, which is what a unit test
 * dispatches — still reaches the game.
 */
export function asPointerEvent(event: Event): PointerLike | null {
  const candidate = event as unknown as PointerLike;
  return typeof candidate.clientX === "number" &&
    typeof candidate.clientY === "number"
    ? candidate
    : null;
}

/** The device an event's `pointerType` names; anything but a finger is a mouse. */
function kindOf(event: PointerLike): PointerKind {
  return event.pointerType === "touch" ? "touch" : "mouse";
}

/** The buffered pointer, as the runtime holds it. */
export class PointerInput {
  private readonly target: EventTarget;
  private readonly map: PointerMapping;
  private samples: PointerSample[] = [];
  /** The last place each device was seen, which is where its lift happens. */
  private readonly last: Record<PointerKind, { x: number; y: number } | null> =
    {
      mouse: null,
      touch: null,
    };
  private detached = false;

  private readonly onMove = (event: Event): void => {
    this.record(event, "move");
  };

  private readonly onDown = (event: Event): void => {
    this.record(event, "down");
  };

  private readonly onUp = (event: Event): void => {
    this.record(event, "up");
  };

  /**
   * A gesture the browser took over — a scroll, a system gesture, a contact that
   * left the window. It is not a release: nothing is confirmed, and the contact
   * is simply forgotten.
   */
  private readonly onCancel = (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer !== null) this.last[kindOf(pointer)] = null;
  };

  constructor(target: EventTarget, map: PointerMapping) {
    this.target = target;
    this.map = map;
    this.target.addEventListener("pointermove", this.onMove);
    this.target.addEventListener("pointerdown", this.onDown);
    this.target.addEventListener("pointerup", this.onUp);
    this.target.addEventListener("pointercancel", this.onCancel);
  }

  /** This frame's samples, oldest first. A pure read. */
  pending(): readonly PointerSample[] {
    return this.samples;
  }

  /** Discard every sample nothing read: a gesture is news for one frame only. */
  endFrame(): void {
    if (this.samples.length > 0) this.samples = [];
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("pointermove", this.onMove);
    this.target.removeEventListener("pointerdown", this.onDown);
    this.target.removeEventListener("pointerup", this.onUp);
    this.target.removeEventListener("pointercancel", this.onCancel);
  }

  private record(event: Event, phase: PointerPhase): void {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    const kind = kindOf(pointer);
    // A lift is resolved where the contact last was: a touch end carries no
    // position of its own, and a mouse release is raised where the mouse stands.
    const at =
      phase === "up" && kind === "touch"
        ? this.last.touch
        : this.map(pointer.clientX as number, pointer.clientY as number);
    if (at === null) return;
    if (phase === "up") this.last[kind] = null;
    else this.last[kind] = at;
    this.samples.push({ kind, phase, x: at.x, y: at.y });
  }
}
