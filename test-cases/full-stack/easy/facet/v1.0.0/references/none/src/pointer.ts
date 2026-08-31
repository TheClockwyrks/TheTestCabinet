// Facet — the pointer, read off the page and reported in stage units.
//
// The game reads three things from this layer (specs/controls.md): a pointer
// position in the stage's logical units, a press edge, and a release edge. It
// never sees a `PointerEvent`. This module listens for the platform's pointer
// events, maps each through the current viewport fit into logical units, and
// records the result two ways:
//
//   * `current()` — where the pointer is now and whether it is pressed, which
//     the game mirrors into its state every frame (specs/state.md).
//   * `samples()` — every press, move, and release since the last frame, in
//     arrival order, so a drag that crossed a cell boundary between two frames
//     is resolved at the cell it crossed rather than at wherever the pointer
//     finished. Reading consumes them.
//
// Resolving every sample rather than only the last is what makes the drag in
// specs/controls.md honest: "the pointer moving within GEM_HIT_R of the center
// of a cell orthogonally adjacent to the pressed cell requests that swap" is a
// statement about the positions the pointer passed through, not about where it
// happened to be when a frame was measured.
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
 * client coordinates — which is what a test dispatches — still reaches the
 * game.
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
    // A press while pressed, or a release while released, is a secondary
    // button or a duplicate event: the position still moves, the edge does
    // not repeat.
    const edged = type !== "move" && (type === "down") !== this.down;
    // While the fit is degenerate there is no logical point to map to; the
    // pointer stays where it last was, and an edge is still recorded there so
    // a press and its release never go missing.
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
