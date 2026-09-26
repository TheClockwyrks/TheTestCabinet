// Facet — the pointer, read off the page and reported in stage units.
//
// The game reads four things from this layer (specs/controls.md): a pointer
// position in the stage's logical units, a press edge, a release edge, and
// which of `mouse`, `pen`, and `touch` drove them. It never sees a
// `PointerEvent`. A mouse, a pen, and a finger all arrive here and all reach
// the game down one path, because Facet's board is played with the pointer
// alone and a player holding a touchscreen has no other way in.
//
// This module listens for the platform's pointer events, maps each through the
// current viewport fit into logical units, and records the result two ways:
//
//   * `current()` — where the pointer is now, whether it is pressed, and what
//     drove it, which the game mirrors into its state every frame
//     (specs/state.md).
//   * `samples()` — every press, move, and release since the last frame, in
//     arrival order, so a drag that crossed a cell boundary between two frames
//     offers into the cell it crossed rather than into wherever the pointer
//     finished. Reading consumes them.
//
// Resolving every sample rather than only the last is what makes the hold in
// specs/controls.md honest: "the pointer moving within GEM_HIT_R of a cell
// orthogonally adjacent to the selected cell offers the selected gem into it"
// is a statement about the positions the pointer passed through, not about
// where it happened to be when a frame was measured.
//
// Samples nothing consumed are discarded at the end of the frame they were
// buffered for, exactly like an unread key edge — except while the game is off
// the wall clock, when the loop only re-presents: a press made between two
// `advance` calls belongs to the next frame that actually runs.

/** Which kind of device drove the pointer (specs/controls.md). */
export type PointerDevice = "mouse" | "pen" | "touch";

/** One pointer event, mapped into logical stage units. */
export interface PointerSample {
  readonly type: "down" | "move" | "up";
  readonly x: number;
  readonly y: number;
  readonly device: PointerDevice;
  /**
   * Whether it came from the primary pointer. The game acts on that one alone,
   * so a second finger resting on a touchscreen changes nothing.
   */
  readonly primary: boolean;
}

/** Where the pointer is, whether it is pressed, and what is driving it. */
export interface PointerPosition {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}

/**
 * Narrows an `Event` to the pointer-shaped event this module reads,
 * structurally rather than with `instanceof`, so a plain `Event` carrying
 * client coordinates — which is what a test dispatches — still reaches the
 * game. An event naming no `pointerType` is taken for a mouse, which is what a
 * synthesized event without one almost always stands in for.
 */
export function asPointerEvent(event: Event): {
  clientX: number;
  clientY: number;
  pointerId: number;
  device: PointerDevice;
  primary: boolean;
} | null {
  const candidate = event as Partial<PointerEvent>;
  if (
    typeof candidate.clientX !== "number" ||
    typeof candidate.clientY !== "number"
  ) {
    return null;
  }
  const type = candidate.pointerType;
  return {
    clientX: candidate.clientX,
    clientY: candidate.clientY,
    pointerId:
      typeof candidate.pointerId === "number" ? candidate.pointerId : 0,
    device: type === "touch" || type === "pen" ? type : "mouse",
    primary: candidate.isPrimary !== false,
  };
}

/**
 * Take the browser's own pointer gestures on the canvas, and hand back the
 * function that gives them back.
 *
 * Four claims, and each is a way a browser otherwise takes an input the game
 * was meant to receive: `touch-action: none` stops a touch drag being taken for
 * a pan, a pinch-zoom, or a double-tap zoom, which is what makes a hold on a
 * gem survive past its first few samples on a touchscreen; `user-select: none`
 * and a transparent tap highlight stop a drag selecting the page and a tap
 * flashing over the board; the `contextmenu` listener keeps the secondary
 * button in the game; and the non-passive `wheel` listener keeps the page from
 * scrolling under the canvas.
 */
export function claimGestures(element: HTMLElement): () => void {
  // A canvas driven headlessly carries no style and no listeners; there are no
  // gestures to take from it, and the runtime is unaffected either way.
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

  const swallow = (event: Event): void => {
    event.preventDefault();
  };
  element.addEventListener("contextmenu", swallow);
  element.addEventListener("wheel", swallow, { passive: false });

  return (): void => {
    style.touchAction = previous.touchAction;
    style.userSelect = previous.userSelect;
    style.webkitUserSelect = previous.webkitUserSelect ?? "";
    style.webkitTapHighlightColor = previous.webkitTapHighlightColor ?? "";
    element.removeEventListener("contextmenu", swallow);
    element.removeEventListener("wheel", swallow);
  };
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
  /** The element a hold is captured on, when the runtime has one. */
  private readonly capture: HTMLElement | null;
  private readonly listeners: [string, (event: Event) => void][] = [];
  private readonly buffer: PointerSample[] = [];
  private x = 0;
  private y = 0;
  private down = false;
  private device: PointerDevice = "mouse";
  private detached = false;

  constructor(
    target: EventTarget,
    map: StageMap,
    capture: HTMLElement | null = null,
  ) {
    this.target = target;
    this.map = map;
    this.capture = capture;
    for (const [name, type] of POINTER_EVENTS) {
      const listener = (event: Event): void => {
        this.record(type, event);
      };
      this.listeners.push([name, listener]);
      this.target.addEventListener(name, listener);
    }
  }

  /** Where the pointer is now, in logical units, and what is driving it. */
  current(): PointerPosition {
    return { x: this.x, y: this.y, down: this.down, device: this.device };
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
    if (at !== null && pointer.primary) {
      this.x = at.x;
      this.y = at.y;
      this.device = pointer.device;
    }
    // A hold that leaves the canvas keeps delivering, and its release is seen,
    // rather than arriving as a `pointercancel` part way through a drag.
    if (pointer.primary && type !== "move") {
      this.retain(type, pointer.pointerId);
    }
    if (type === "move" || edged) {
      if (type !== "move" && pointer.primary) this.down = type === "down";
      this.buffer.push({
        type,
        x: at !== null ? at.x : this.x,
        y: at !== null ? at.y : this.y,
        device: pointer.device,
        primary: pointer.primary,
      });
    }
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
