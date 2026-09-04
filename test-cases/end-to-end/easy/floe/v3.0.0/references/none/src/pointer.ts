// Floe — the mouse and the finger, beneath the game.
//
// `specs/controls.md` puts the keyboard in the runtime layer and puts a pointer
// and a touch contact beside it: both drive the menus directly rather than
// through a key, and this layer delivers them. What reaches the game is a list
// of EDGES per tick, in the order the browser raised them, already mapped from
// CSS pixels into the stage's own logical units through the viewport the frame
// was fitted with.
//
// TWO KINDS OF EDGE, because `specs/ui.md` asks two different questions of a
// gesture. An `aim` is a position the player is indicating — a mouse moved, a
// contact landed or travelled — and it selects whatever it is over. A `release`
// carries BOTH ends of the gesture, the point the press landed on and the point
// it lifted at, because a confirm is only a confirm when the two fall in one
// item's region. Pairing them here rather than in the game is what keeps the
// game's state free of a latched press: the rules read a tick's edges and keep
// nothing of their own between ticks.
//
// A MOUSE AIMS WHILE IT HOVERS AND A FINGER ONLY WHILE IT IS DOWN. That is the
// difference `specs/ui.md` draws between "a pointer moves onto an item's region"
// and "a touch contact lands inside an item's region, or travels onto one", and
// it is the only place this layer treats the two devices differently.

import type { Viewport } from "./viewport";

/** What a pointer did, in logical stage units. */
export type PointerEdge =
  /** A position the player is indicating: a hover, a landing, or a travel. */
  | { readonly kind: "aim"; readonly x: number; readonly y: number }
  /**
   * A gesture that ended: where it lifted, and where the press that began it
   * landed. A lift with no press behind it carries no `from` and confirms
   * nothing.
   */
  | {
      readonly kind: "release";
      readonly x: number;
      readonly y: number;
      readonly fromX: number;
      readonly fromY: number;
    };

/** Where the pointer reads its geometry from, one frame at a time. */
export interface PointerSurface {
  /** The element pointer positions are measured from. */
  bounds(): { left: number; top: number };
  /** Device pixels per CSS pixel. */
  dpr(): number;
  /** The stage-to-device fit the last frame was drawn with. */
  viewport(): Viewport;
  /** The target pointer events are listened for on. */
  events(): EventTarget;
}

/**
 * Narrows an `Event` to a pointer-shaped one structurally rather than with
 * `instanceof`, so an event dispatched from another realm — or a plain `Event`
 * carrying the three fields, which is what a browser automation driver sends —
 * still reaches the game.
 */
function asPointerEvent(
  event: Event,
): { clientX: number; clientY: number; pointerType: string } | null {
  const candidate = event as Partial<PointerEvent>;
  if (typeof candidate.clientX !== "number") return null;
  if (typeof candidate.clientY !== "number") return null;
  return {
    clientX: candidate.clientX,
    clientY: candidate.clientY,
    pointerType:
      typeof candidate.pointerType === "string"
        ? candidate.pointerType
        : "mouse",
  };
}

/** The pointer and the finger, as one queue of edges the tick drains. */
export class Pointer {
  private readonly surface: PointerSurface;
  private edges: PointerEdge[] = [];
  /** Where the press that is still down landed, or `null` while nothing is. */
  private pressed: { x: number; y: number } | null = null;
  private detached = false;

  private readonly onDown = (event: Event): void => {
    const at = this.locate(event);
    if (at === null) return;
    this.pressed = at;
    this.edges.push({ kind: "aim", x: at.x, y: at.y });
  };

  private readonly onMove = (event: Event): void => {
    const pointer = asPointerEvent(event);
    if (pointer === null) return;
    // A finger indicates nothing while it is off the glass; a mouse indicates
    // wherever it hovers (specs/ui.md).
    if (pointer.pointerType === "touch" && this.pressed === null) return;
    const at = this.locate(event);
    if (at === null) return;
    this.edges.push({ kind: "aim", x: at.x, y: at.y });
  };

  private readonly onUp = (event: Event): void => {
    const at = this.locate(event);
    const from = this.pressed;
    this.pressed = null;
    if (at === null || from === null) return;
    this.edges.push({
      kind: "release",
      x: at.x,
      y: at.y,
      fromX: from.x,
      fromY: from.y,
    });
  };

  private readonly onCancel = (): void => {
    this.pressed = null;
  };

  constructor(surface: PointerSurface) {
    this.surface = surface;
    const target = surface.events();
    target.addEventListener("pointerdown", this.onDown);
    target.addEventListener("pointermove", this.onMove);
    target.addEventListener("pointerup", this.onUp);
    target.addEventListener("pointercancel", this.onCancel);
  }

  /** Every edge raised since the last {@link Pointer.endTick}, in order. */
  samples(): readonly PointerEdge[] {
    return this.edges;
  }

  /**
   * Discard the tick's edges.
   *
   * A gesture is news for one tick, exactly as a key press is: an edge left in
   * the queue would be acted on again on the next tick, and a menu would confirm
   * twice from one click.
   */
  endTick(): void {
    if (this.edges.length > 0) this.edges = [];
  }

  /** Drop the listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    const target = this.surface.events();
    target.removeEventListener("pointerdown", this.onDown);
    target.removeEventListener("pointermove", this.onMove);
    target.removeEventListener("pointerup", this.onUp);
    target.removeEventListener("pointercancel", this.onCancel);
  }

  /**
   * Where an event landed on the stage, or `null` when the fit has no scale —
   * which is what a canvas the page has not laid out yet reports.
   */
  private locate(event: Event): { x: number; y: number } | null {
    const pointer = asPointerEvent(event);
    if (pointer === null) return null;
    const viewport = this.surface.viewport();
    if (!(viewport.scale > 0)) return null;
    const bounds = this.surface.bounds();
    const dpr = this.surface.dpr();
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const deviceX = (pointer.clientX - bounds.left) * ratio;
    const deviceY = (pointer.clientY - bounds.top) * ratio;
    return {
      x: (deviceX - viewport.offsetX) / viewport.scale,
      y: (deviceY - viewport.offsetY) / viewport.scale,
    };
  }
}
