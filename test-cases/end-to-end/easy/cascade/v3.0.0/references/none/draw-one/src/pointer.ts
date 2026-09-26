// Cascade — the pointer, read off the page and reported in stage units.
//
// The game reads three things from this layer (`specs/controls.md`): a press, a
// move, and a release, each carrying a position in the stage's logical units.
// It never sees a `PointerEvent`. This module listens for the platform's
// pointer events, maps each through the current viewport fit into logical
// units, and buffers the result.
//
// `samples()` hands back every press, move and release since the last frame, IN
// ARRIVAL ORDER, and reading consumes them. That order is the whole point: a
// press and the release that followed it inside one frame both take effect, so
// a gesture is never reduced to the last position of the frame that carried it.
//
// Samples nothing consumed are discarded at the end of the frame they were
// buffered for, exactly like an unread key edge — except while the game is off
// the wall clock, when the loop only re-presents: a press made between two
// `advance` calls belongs to the next frame that actually runs.

/** One pointer event, mapped into logical stage units. */
export interface PointerSample {
  readonly type: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
}

/** Where the pointer is and whether it is pressed. */
export interface PointerPosition {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

/**
 * Narrows an `Event` to the pointer-shaped event this module reads,
 * structurally rather than with `instanceof`, so a plain `Event` carrying
 * client coordinates — which is what a test and a browser automation driver
 * both dispatch — still reaches the game. A non-primary touch is ignored, so a
 * second finger never fights the first for the card in hand.
 */
export function asPointerEvent(
  event: Event,
): { clientX: number; clientY: number } | null {
  const candidate = event as Partial<PointerEvent>;
  if (candidate.isPrimary === false) return null;
  return typeof candidate.clientX === "number" &&
    typeof candidate.clientY === "number"
    ? { clientX: candidate.clientX, clientY: candidate.clientY }
    : null;
}

/** The events listened for, and the sample type each becomes. */
const POINTER_EVENTS = [
  ["pointerdown", "down"],
  ["pointermove", "move"],
  ["pointerup", "up"],
  ["pointercancel", "up"],
] as const;

/** How a client-space event position becomes a logical stage position. */
export type StageMap = (
  clientX: number,
  clientY: number,
) => { x: number; y: number } | null;

export class Pointer {
  private readonly target: EventTarget;
  private readonly map: StageMap;
  private readonly listeners: [string, (event: Event) => void][] = [];
  private readonly buffer: PointerSample[] = [];
  private x = 0;
  private y = 0;
  private down = false;
  private detached = false;

  constructor(target: EventTarget, map: StageMap) {
    this.target = target;
    this.map = map;
    for (const [name, type] of POINTER_EVENTS) {
      const listener = (event: Event): void => {
        this.record(type, event);
      };
      this.listeners.push([name, listener]);
      this.target.addEventListener(name, listener);
    }
  }

  /** Where the pointer is now, in logical units, and whether it is pressed. */
  current(): PointerPosition {
    return { x: this.x, y: this.y, down: this.down };
  }

  /** This frame's samples, in arrival order. Reading consumes them. */
  samples(): PointerSample[] {
    return this.buffer.splice(0);
  }

  /** Discard every sample nothing consumed: input is news for one frame only. */
  endFrame(): void {
    this.buffer.length = 0;
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    for (const [name, listener] of this.listeners) {
      this.target.removeEventListener(name, listener);
    }
  }

  private record(type: PointerSample["type"], event: Event): void {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    // A press while pressed, or a release while released, is a secondary button
    // or a duplicate event: the position still moves, the edge does not repeat.
    const edged = type !== "move" && (type === "down") !== this.down;
    // While the fit is degenerate there is no logical point to map to; the
    // pointer stays where it last was, and an edge is still recorded there so a
    // press and its release never go missing.
    const at = this.map(pointer.clientX, pointer.clientY);
    if (at !== null) {
      this.x = at.x;
      this.y = at.y;
    }
    if (type === "move" || edged) {
      if (type !== "move") this.down = type === "down";
      this.buffer.push({ type, x: this.x, y: this.y });
    }
  }
}
