// Fathom — the pointer and the finger, as samples in logical units.
//
// The menus take a mouse and a touch contact as well as the keyboard
// (`specs/ui.md`), and this build stands on no engine, so the layer that turns a
// browser's pointer events into something the game can read is part of it. That
// layer is here, beside `src/keyboard.ts`, and it answers one question:
//
//   * `samples()` — what did the pointer do since the last tick, in order?
//
// A LIST RATHER THAN A POSITION, because the two menu gestures the specification
// fixes are about ORDER: a press and a release inside one item's region confirm
// it, and the same two edges in different regions confirm nothing. A reading that
// answered "where is the pointer now, and is it held" would lose the region the
// press landed in, so the game reads the edges themselves.
//
// EVERY SAMPLE IS IN LOGICAL UNITS. A browser reports a position in CSS pixels
// from the top-left of the window; the game draws in the fixed logical stage
// `specs/overview.md` defines. The map between them is the same letterboxed fit
// the renderer draws under, read at the moment of the event rather than held, so
// a window resized between two frames places the next event correctly.
//
// The list is cleared at the end of every tick, exactly as a key edge is, so a
// tick reads what happened since the previous one and a run of them costs a
// bounded amount however long it goes on.

import type { Viewport } from "./viewport";

/** What one sample says the pointer did. */
export type PointerSampleType = "down" | "move" | "up";

/** Which device drove a sample. A finger never hovers, and reports itself. */
export type PointerDevice = "mouse" | "pen" | "touch";

/** One thing the pointer did, placed on the logical stage. */
export interface PointerSample {
  readonly type: PointerSampleType;
  /** Where it landed, in logical units. */
  readonly x: number;
  readonly y: number;
  readonly device: PointerDevice;
}

/**
 * The most samples one tick's list holds.
 *
 * A browser coalesces `pointermove` to about one per animation frame, so a real
 * hand produces a handful between two ticks and never approaches this. The cap
 * is for the frames that stop arriving — a hidden tab whose animation callbacks
 * are suspended while the pointer keeps streaming — where an unbounded list
 * would grow for as long as the tab stayed hidden.
 */
const SAMPLE_CAP = 256;

/**
 * Narrows an `Event` to the fields a pointer event carries, structurally rather
 * than with `instanceof`, so an event dispatched from another realm — which is
 * what a browser automation driver delivers — still reaches the game.
 */
function asPointerEvent(
  event: Event,
): { clientX: number; clientY: number; pointerType?: string } | null {
  const candidate = event as Partial<PointerEvent>;
  if (
    typeof candidate.clientX !== "number" ||
    typeof candidate.clientY !== "number"
  ) {
    return null;
  }
  return candidate as {
    clientX: number;
    clientY: number;
    pointerType?: string;
  };
}

/** The device a `pointerType` names, defaulting to a mouse. */
function namedDevice(pointerType: string | undefined): PointerDevice {
  return pointerType === "touch" || pointerType === "pen"
    ? pointerType
    : "mouse";
}

/** The pointer's samples, collected between ticks. */
export class Pointer {
  private readonly target: EventTarget;
  /** The live fit and pixel density, read at each event rather than held. */
  private readonly viewport: () => Viewport;
  private readonly dpr: () => number;
  private samples: PointerSample[] = [];
  private detached = false;

  private readonly listen =
    (type: PointerSampleType) =>
    (event: Event): void => {
      const read = asPointerEvent(event);
      if (read === null) return;
      const view = this.viewport();
      // A zero-sized element has no fit, so an event over it lands nowhere.
      if (view.scale === 0) return;
      const ratio = this.dpr();
      const density = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
      if (this.samples.length >= SAMPLE_CAP) return;
      this.samples.push({
        type,
        x: (read.clientX * density - view.offsetX) / view.scale,
        y: (read.clientY * density - view.offsetY) / view.scale,
        device: namedDevice(read.pointerType),
      });
    };

  private readonly onDown = this.listen("down");
  private readonly onMove = this.listen("move");
  private readonly onUp = this.listen("up");

  constructor(
    target: EventTarget,
    viewport: () => Viewport,
    dpr: () => number,
  ) {
    this.target = target;
    this.viewport = viewport;
    this.dpr = dpr;
    target.addEventListener("pointerdown", this.onDown);
    target.addEventListener("pointermove", this.onMove);
    target.addEventListener("pointerup", this.onUp);
  }

  /** Everything the pointer did since the last tick closed, in arrival order. */
  read(): readonly PointerSample[] {
    return this.samples;
  }

  /** Drop the tick's samples. Called at the end of every tick, as keys are. */
  endTick(): void {
    if (this.samples.length > 0) this.samples = [];
  }

  /** Stop listening. Idempotent. */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.target.removeEventListener("pointerdown", this.onDown);
    this.target.removeEventListener("pointermove", this.onMove);
    this.target.removeEventListener("pointerup", this.onUp);
  }
}
