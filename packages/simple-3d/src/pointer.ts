/**
 * The pointer: the engine's single answer to "where is the player pointing, and
 * are they holding?".
 *
 * A game never reads `PointerEvent`s. The engine listens on the same target its
 * key listeners go on, maps each event's client position through the letterboxed
 * fit the picture is projected into, and hands `update` positions in the game's
 * own logical coordinates — through `UpdateApi.input` — so the device pixel
 * ratio and the letterbox bars never appear in game code. The pointer is the one
 * input whose meaning depends on where the picture is, and every pointer game
 * otherwise re-derives that conversion slightly wrong.
 *
 * The pointer stays 2D. What a logical position means inside the scene is
 * picking, and it belongs to whoever needs it: `pointerRay` (the viewport
 * module) turns the position a game reads here into the world-space ray through
 * it, and treating a position outside the logical field — a point inside a
 * letterbox bar maps outside `0..width` or `0..height` — as a miss is the
 * game's choice. This module therefore needs only the {@link Viewport} value,
 * never the camera.
 *
 * Two reads serve two designs. The snapshot answers "where now, and held?",
 * which is what aiming needs. The per-frame sample list holds every position
 * delivered since the input frame last closed, in arrival order, which is what
 * direct manipulation needs: a sweep that crossed several targets between two
 * frames arrives as the ordered positions it visited rather than as the last
 * one alone.
 *
 * **Nothing here grows with the length of a run.** The sample list is cleared
 * every time the frame loop closes the input frame, and it is bounded at
 * {@link POINTER_SAMPLE_CAP} in between, so a burst of events between two frames
 * — or a run whose frames have stopped closing — costs a fixed amount however
 * long it goes on. A sample past the cap still moves the snapshot and the
 * edges; only its place in the list is refused.
 */

import type { Viewport } from "./math";
import type { SurfaceMetrics } from "./viewport";

/** What one pointer sample reports the pointer doing. */
export type PointerSampleType = "down" | "move" | "up";

/**
 * One pointer sample: what happened and where, in the game's logical
 * coordinates.
 *
 * Samples are the per-position record a game that reacts to the path the
 * pointer traveled reads: a sweep that crossed several targets between two
 * frames arrives as the ordered positions it visited rather than as the last
 * one alone.
 */
export interface PointerSample {
  /** What the pointer did. */
  readonly type: PointerSampleType;
  /** The logical x the sample landed at. */
  readonly x: number;
  /** The logical y the sample landed at. */
  readonly y: number;
}

/**
 * The pointer as a frame reads it: the most recent position, in the game's
 * logical coordinates, and whether the pointer is held.
 *
 * Before the first pointer event the position is `(0, 0)` and `down` is
 * `false`. A point inside a letterbox bar maps outside `0..width` or
 * `0..height`, so a game clamps it or treats it as a miss.
 */
export interface PointerSnapshot {
  /** The most recent logical x. */
  x: number;
  /** The most recent logical y. */
  y: number;
  /** Whether the pointer is held. */
  down: boolean;
}

/**
 * The most samples one frame lists.
 *
 * Browsers coalesce `pointermove` to roughly one per animation frame, so a real
 * player produces a handful of samples per frame and never approaches this. The
 * cap exists for the frames that stop closing — a hidden tab whose animation
 * callbacks are suspended while the pointer keeps streaming — where an unbounded
 * list would grow for as long as the tab stays hidden.
 */
export const POINTER_SAMPLE_CAP = 1024;

export class PointerInput {
  /** The target the listeners went on, taken from the surface once (see `InputRegistry`). */
  readonly #target: EventTarget;
  readonly #surface: SurfaceMetrics;
  /**
   * The live fit, read at each event rather than held: events arrive between
   * frames, and the fit in force at that moment — not the one some earlier frame
   * computed — is what places the event on the stage.
   */
  readonly #viewport: () => Viewport;
  #x = 0;
  #y = 0;
  #down = false;
  #pressedEdge = false;
  #releasedEdge = false;
  #samples: PointerSample[] = [];
  #detached = false;

  readonly #onDown = (event: Event): void => {
    const position = this.#position(event);
    if (position.kind !== "at") return;
    // A second `pointerdown` while already held — a chorded mouse button — is a
    // continuation of the hold, not a new press, so the listed samples alternate
    // `down` and `up` strictly and an edge means exactly one thing.
    if (this.#down) {
      this.#record("move", position.x, position.y);
      return;
    }
    this.#down = true;
    this.#pressedEdge = true;
    this.#record("down", position.x, position.y);
  };

  readonly #onMove = (event: Event): void => {
    const position = this.#position(event);
    if (position.kind !== "at") return;
    this.#record("move", position.x, position.y);
  };

  readonly #onUp = (event: Event): void => {
    const position = this.#position(event);
    if (position.kind === "ignore") return;
    if (position.kind === "unplaced") {
      // The release still ends the hold: a degenerate fit can place no position,
      // but leaving `down` stranded would hold a trace, a drag, or an aim for
      // the rest of the run over one hidden-canvas release.
      this.#release();
      return;
    }
    // A `pointerup` while not held has no hold to end; it still says where the
    // pointer is.
    if (!this.#down) {
      this.#record("move", position.x, position.y);
      return;
    }
    this.#x = position.x;
    this.#y = position.y;
    this.#release();
  };

  /**
   * A cancelled pointer — the browser took the gesture for scrolling, the touch
   * left the surface — ends the hold as a release at the last known position.
   * Its own coordinates are not read: a cancel is the browser saying the gesture
   * stopped being the page's, not a report of where it went.
   */
  readonly #onCancel = (event: Event): void => {
    if ((event as Partial<PointerEvent>).isPrimary === false) return;
    this.#release();
  };

  /**
   * Attaches to the target the surface supplies, immediately, for the same
   * reason the key listeners do (see `InputRegistry`): it is the one seam an
   * engine with no document behind it still has, and a caller that dispatches a
   * pointer-shaped event at it reaches the game by the path a player's pointer
   * takes.
   */
  constructor(surface: SurfaceMetrics, viewport: () => Viewport) {
    this.#surface = surface;
    this.#viewport = viewport;
    this.#target = surface.events();
    this.#target.addEventListener("pointerdown", this.#onDown);
    this.#target.addEventListener("pointermove", this.#onMove);
    this.#target.addEventListener("pointerup", this.#onUp);
    this.#target.addEventListener("pointercancel", this.#onCancel);
  }

  /** The most recent position and hold, as a fresh copy the caller owns. */
  snapshot(): PointerSnapshot {
    return { x: this.#x, y: this.#y, down: this.#down };
  }

  /**
   * Whether the pointer was pressed since the last frame — true exactly once per
   * armed edge, then consumed, for the same reason an action's `pressed` is: a
   * menu and a gameplay layer both asking in one frame must not both act on one
   * press.
   */
  pressed(): boolean {
    if (!this.#pressedEdge) return false;
    this.#pressedEdge = false;
    return true;
  }

  /** Whether the pointer was released since the last frame; consumed on read. */
  released(): boolean {
    if (!this.#releasedEdge) return false;
    this.#releasedEdge = false;
    return true;
  }

  /**
   * The samples delivered since the input frame last closed, in arrival order,
   * as a fresh copy. Not consumed on read: the list is a record of the frame's
   * path rather than an edge, and two readers of one frame read one path.
   */
  samples(): PointerSample[] {
    return [...this.#samples];
  }

  /**
   * Closes the pointer's input frame: the sample list empties and unconsumed
   * edges are discarded. Called by the frame loop beside the action registry's
   * `endFrame`, so a press is news for exactly one frame here too.
   */
  endFrame(): void {
    this.#samples = [];
    this.#pressedEdge = false;
    this.#releasedEdge = false;
  }

  /** Detaches the pointer listeners. Idempotent, because teardown races. */
  detach(): void {
    if (this.#detached) return;
    this.#detached = true;
    this.#target.removeEventListener("pointerdown", this.#onDown);
    this.#target.removeEventListener("pointermove", this.#onMove);
    this.#target.removeEventListener("pointerup", this.#onUp);
    this.#target.removeEventListener("pointercancel", this.#onCancel);
  }

  /** Ends the hold at the last known position, arming the release edge. */
  #release(): void {
    if (!this.#down) return;
    this.#down = false;
    this.#releasedEdge = true;
    this.#record("up", this.#x, this.#y);
  }

  /**
   * The event's position in logical coordinates, or the refusal that keeps it
   * off the stage.
   *
   * `ignore` is an event this input does not track at all: one with no numeric
   * client position — the narrowing is structural, like the key listeners', so
   * a plain `Event` carrying `clientX`/`clientY` from any realm drives the
   * pointer — or a non-primary pointer, the second touch of a multi-touch
   * gesture, since one logical pointer is tracked. `unplaced` is a real pointer
   * event a degenerate fit (a `scale` of `0`) gives no place on the stage: it is
   * dropped as a position, and the one listener that must still act on it — a
   * release, which ends the hold wherever it happened — tells the two apart.
   */
  #position(
    event: Event,
  ):
    | { kind: "at"; x: number; y: number }
    | { kind: "ignore" }
    | { kind: "unplaced" } {
    const candidate = event as Partial<PointerEvent>;
    if (
      typeof candidate.clientX !== "number" ||
      typeof candidate.clientY !== "number"
    ) {
      return { kind: "ignore" };
    }
    if (candidate.isPrimary === false) return { kind: "ignore" };
    const viewport = this.#viewport();
    if (viewport.scale === 0) return { kind: "unplaced" };
    const origin = this.#surface.origin?.() ?? { x: 0, y: 0 };
    const dpr = this.#surface.dpr();
    const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    return {
      kind: "at",
      x:
        ((candidate.clientX - origin.x) * ratio - viewport.offsetX) /
        viewport.scale,
      y:
        ((candidate.clientY - origin.y) * ratio - viewport.offsetY) /
        viewport.scale,
    };
  }

  /**
   * Moves the snapshot and lists the sample, refusing the listing — and only the
   * listing — past the cap.
   */
  #record(type: PointerSample["type"], x: number, y: number): void {
    this.#x = x;
    this.#y = y;
    if (this.#samples.length < POINTER_SAMPLE_CAP) {
      this.#samples.push({ type, x, y });
    }
  }
}
