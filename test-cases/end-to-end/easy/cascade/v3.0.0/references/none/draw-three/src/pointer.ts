// Cascade — the pointer, as the runtime hands it to the game.
//
// Cascade is played with a pointer and a mouse and a touchscreen stand on the
// same footing (specs/controls.md), so this layer normalizes both into one kind
// of thing: a PHASE and a point on the logical stage.
//
// Two rules of specs/controls.md live here rather than in the game:
//
//   * A non-primary touch is ignored, so a second finger on the glass never
//     splits a drag in two.
//   * Every sample is delivered on its own, in the order it arrived. The runtime
//     hands each event to the game as it happens rather than remembering the last
//     one of a frame, so a press and the release that followed it inside one
//     frame both take effect.
//
// The DOM listeners themselves are the runtime's (`src/runtime.ts`); what is here
// is the normalization, which is pure and is checked without a browser.

/** What a pointer sample is: a press, a travel, a release, or a cancellation. */
export type PointerPhase = "down" | "move" | "up" | "cancel";

/** One pointer sample, at a point on the logical stage. */
export interface PointerSample {
  readonly phase: PointerPhase;
  /** The logical stage x. */
  readonly x: number;
  /** The logical stage y. */
  readonly y: number;
}

/**
 * The part of a `PointerEvent` this build reads.
 *
 * Structural on purpose: a real browser event satisfies it, and so does the
 * plain object a test dispatches, so nothing here needs a DOM to be checked.
 */
export interface PointerLike {
  /** The event's x in client space, in CSS pixels. */
  readonly clientX: number;
  /** The event's y in client space, in CSS pixels. */
  readonly clientY: number;
  /** Whether this is the primary pointer of its kind. */
  readonly isPrimary?: boolean;
}

/** The DOM event types the runtime listens for, and the phase each carries. */
export const POINTER_EVENTS: readonly (readonly [string, PointerPhase])[] = [
  ["pointerdown", "down"],
  ["pointermove", "move"],
  ["pointerup", "up"],
  ["pointercancel", "cancel"],
] as const;

/**
 * An event as a pointer this build answers, or `null` when it is not one.
 *
 * A non-primary pointer — the second finger of a two-finger touch — is dropped
 * here, which is the whole of that rule.
 */
export function asPointerEvent(event: Event): PointerLike | null {
  const candidate = event as unknown as Partial<PointerLike>;
  if (typeof candidate.clientX !== "number") return null;
  if (typeof candidate.clientY !== "number") return null;
  if (candidate.isPrimary === false) return null;
  return candidate as PointerLike;
}
