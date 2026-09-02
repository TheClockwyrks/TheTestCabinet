// Orrery — the pointer, read off the page and reported in stage units
// (specs/controls.md "The pointer").
//
// The game reads exactly three things from this layer: a pointer position in
// the stage's logical units, a press edge, and a release edge. It never sees a
// `PointerEvent`. A mouse, a pen, and a finger all arrive here and all reach
// the game down one path, because the editor is operated with the pointer and
// a player holding a touchscreen has no other way in.
//
// The samples are ORDERED and every one of them is resolved. specs/controls.md
// fixes that: "Each pointer position is resolved on its own, in the order the
// positions arrive, so a drag's ghost and a track being laid follow the
// pointer hex by hex." A drag that crossed three hexes between two frames must
// lay three cells of track, not one, so the frame reads every position the
// pointer passed through rather than only where it finished.
//
// A press captures the pointer on the canvas, so a drag that leaves the canvas
// keeps delivering and its release is seen, rather than arriving as a
// `pointercancel` part way through laying a track.

/** One pointer event, mapped into logical stage units. */
export interface PointerSample {
  readonly type: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
}

/** Where the pointer is, and whether it is pressed. */
export interface PointerReading {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
}

/**
 * Narrows an `Event` to the pointer-shaped event this module reads,
 * structurally rather than with `instanceof`, so a plain `Event` carrying
 * client coordinates — which is what a test and an automation driver dispatch
 * — still reaches the game.
 */
export function asPointerEvent(event: Event): {
  clientX: number;
  clientY: number;
  pointerId: number;
  primary: boolean;
} | null {
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
      typeof candidate.pointerId === "number" ? candidate.pointerId : 0,
    primary: candidate.isPrimary !== false,
  };
}

/** How a client-space event position becomes a logical stage position. */
export type StageMap = (
  clientX: number,
  clientY: number,
) => { x: number; y: number } | null;

/** The element a press is captured on, and released from. */
export interface CaptureTarget {
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
}

/** The events listened for, and the sample each becomes. */
const POINTER_EVENTS = [
  ["pointerdown", "down"],
  ["pointermove", "move"],
  ["pointerup", "up"],
  ["pointercancel", "up"],
] as const;

export class Pointer {
  private readonly target: EventTarget;
  private readonly map: StageMap;
  private readonly capture: CaptureTarget | null;
  private readonly listeners: [string, (event: Event) => void][] = [];
  private readonly buffer: PointerSample[] = [];
  private x = 0;
  private y = 0;
  private down = false;
  private detached = false;

  constructor(
    target: EventTarget,
    map: StageMap,
    capture: CaptureTarget | null = null,
  ) {
    this.target = target;
    this.map = map;
    this.capture = capture;
    for (const [name, type] of POINTER_EVENTS) {
      const listener = (event: Event): void => this.record(type, event);
      this.listeners.push([name, listener]);
      this.target.addEventListener(name, listener);
    }
  }

  /** Where the pointer is now, in logical units, and whether it is pressed. */
  current(): PointerReading {
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
    // button or a duplicate: the position still moves, the edge does not
    // repeat.
    const edged = type !== "move" && (type === "down") !== this.down;
    // While the fit is degenerate there is no logical point to map to; the
    // pointer stays where it last was, and the edge is still recorded there so
    // a press and its release never go missing.
    const at = this.map(pointer.clientX, pointer.clientY);
    if (at !== null && pointer.primary) {
      this.x = at.x;
      this.y = at.y;
    }
    if (pointer.primary && type !== "move")
      this.retain(type, pointer.pointerId);
    if (type !== "move" && !edged) return;
    if (type !== "move" && pointer.primary) this.down = type === "down";
    this.buffer.push({ type, x: this.x, y: this.y });
  }

  /** Hold a pressed pointer on the canvas, and let it go on the release. */
  private retain(type: PointerSample["type"], pointerId: number): void {
    const element = this.capture;
    if (element === null) return;
    try {
      if (type === "down") element.setPointerCapture(pointerId);
      else element.releasePointerCapture(pointerId);
    } catch {
      // The pointer ended between the event and this call; nothing to route.
    }
  }
}

/**
 * Take the browser's own gestures on the canvas, and hand back the function
 * that gives them back. Each claim is a way a browser otherwise takes an input
 * the editor was meant to receive: `touch-action: none` stops a touch drag
 * being taken for a pan or a double-tap zoom, `user-select: none` and a
 * transparent tap highlight stop a drag selecting the page and a tap flashing
 * over the field, and the `contextmenu` listener keeps the secondary button in
 * the game.
 */
export function claimGestures(element: HTMLElement): () => void {
  const style = element.style as
    | (CSSStyleDeclaration & {
        webkitUserSelect?: string;
        webkitTapHighlightColor?: string;
      })
    | undefined;
  if (style === undefined || typeof element.addEventListener !== "function") {
    return (): void => {};
  }
  const previous = {
    touchAction: style.touchAction,
    userSelect: style.userSelect,
    webkitUserSelect: style.webkitUserSelect,
    webkitTapHighlightColor: style.webkitTapHighlightColor,
  };
  style.touchAction = "none";
  style.userSelect = "none";
  style.webkitUserSelect = "none";
  style.webkitTapHighlightColor = "transparent";
  const swallow = (event: Event): void => event.preventDefault();
  element.addEventListener("contextmenu", swallow);
  return (): void => {
    style.touchAction = previous.touchAction;
    style.userSelect = previous.userSelect;
    style.webkitUserSelect = previous.webkitUserSelect ?? "";
    style.webkitTapHighlightColor = previous.webkitTapHighlightColor ?? "";
    element.removeEventListener("contextmenu", swallow);
  };
}
