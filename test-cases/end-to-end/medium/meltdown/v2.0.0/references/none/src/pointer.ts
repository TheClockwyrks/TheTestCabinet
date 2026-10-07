// Meltdown — the pointer, read off the page and reported in stage units.
//
// The game never sees a `PointerEvent`. This module listens for the platform's
// pointer events, maps each through the current viewport fit into logical stage
// units, and hands it straight on: there is no buffer and nothing waits for a
// frame. Meltdown is a game of presses on a panel and on a floor
// (specs/controls.md), and every one of them resolves the moment it arrives, so
// a press made between two frames is not silently reordered against the frame
// that happens to run next.
//
// The same door takes a REPORTED event, which is how `window.__meltdown`'s
// `pointerDown`, `pointerMove` and `pointerUp` reach the game
// (specs/instrumentation.md): a posed press and a player's press are then
// literally the same event on the same path.

/** One pointer event, in logical stage units. */
export interface PointerSample {
  readonly type: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
  /**
   * Whether this event was REPORTED through the debug surface rather than made
   * by a player. It resolves identically either way; the flag exists only so the
   * game can decline to raise a cue for it, because an operation of that surface
   * resolves outside the frame loop a cue is played from
   * (specs/instrumentation.md).
   */
  readonly silent: boolean;
}

/** Where the pointer is and whether it is pressed. */
export interface PointerPosition {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

/**
 * Narrows an `Event` to the pointer-shaped event this module reads,
 * structurally rather than with `instanceof`, so a plain `Event` carrying client
 * coordinates — which is what a test dispatches — still reaches the game.
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

/** What the pointer does with each event it resolves. */
export type PointerListener = (sample: PointerSample) => void;

export class Pointer {
  private readonly target: EventTarget;
  private readonly map: StageMap;
  private readonly listener: PointerListener;
  private readonly listeners: [string, (event: Event) => void][] = [];
  private x = 0;
  private y = 0;
  private down = false;
  private detached = false;

  constructor(target: EventTarget, map: StageMap, listener: PointerListener) {
    this.target = target;
    this.map = map;
    this.listener = listener;
    for (const [name, type] of POINTER_EVENTS) {
      const handler = (event: Event): void => {
        const pointer = asPointerEvent(event);
        if (pointer === null) return;
        // While the fit is degenerate there is no logical point to map to; the
        // pointer stays where it last was, and the edge is still reported there
        // so a press and its release never go missing.
        const at = this.map(pointer.clientX, pointer.clientY);
        this.report(type, at?.x ?? this.x, at?.y ?? this.y, false);
      };
      this.listeners.push([name, handler]);
      this.target.addEventListener(name, handler);
    }
  }

  /** Where the pointer is now, in logical units, and whether it is pressed. */
  current(): PointerPosition {
    return { x: this.x, y: this.y, down: this.down };
  }

  /** Report an event in logical stage units, from the page or from code. */
  report(
    type: PointerSample["type"],
    x: number,
    y: number,
    silent: boolean,
  ): void {
    this.x = x;
    this.y = y;
    // A press while pressed, or a release while released, is a duplicate: the
    // position still moves, the edge does not repeat.
    if (type !== "move") {
      if ((type === "down") === this.down) return;
      this.down = type === "down";
    }
    this.listener({ type, x, y, silent });
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    for (const [name, handler] of this.listeners) {
      this.target.removeEventListener(name, handler);
    }
  }
}
