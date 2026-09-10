// The events a check raises on the engine's own event target.
//
// Under an engine there is no browser, so there is no `KeyboardEvent` and no
// `PointerEvent`. What every engine harness does instead is dispatch a plain
// `Event` carrying the fields the engine's input system reads, on the
// `EventTarget` its {@link EngineSurfaceMetrics} handed over. The engines read
// those fields STRUCTURALLY — `input.ts` in each of them takes an `Event` from
// any realm and looks for `clientX`, `pointerType` and the rest — so an event
// built here drives the engine exactly as a browser's own does.
//
// TWO POINTER EVENTS SHIP, AND THEY ARE NOT INTERCHANGEABLE. The `KeyEvent`
// below was byte-identical in every engine harness sampled. The pointer event was
// not: some cases dispatch the bare three fields, and some also carry
// `pointerId`, `pointerType`, `button` and `buttons`. That is not cosmetic drift.
// A structured engine's pointer input reads `button` and `buttons` and falls back
// to a primary-button contact when they are ABSENT, so an event that names them
// takes a different path through the engine than one that does not — a case's
// verdicts are decided under the one it has always dispatched. Both ship, under
// names that say which is which, and a case binds the one it means.

import type { EngineSurfaceMetrics } from "./contract";

/**
 * A `KeyboardEvent`-shaped event: every engine's input system reads `code` and
 * `repeat`, and nothing else off a key event.
 */
export class KeyEvent extends Event {
  readonly code: string;
  readonly repeat: boolean;

  constructor(type: "keydown" | "keyup", code: string, repeat = false) {
    super(type);
    this.code = code;
    this.repeat = repeat;
  }
}

/** The three pointer event types an engine's input system listens for. */
export type PointerEventType = "pointerdown" | "pointermove" | "pointerup";

/**
 * A `PointerEvent`-shaped event carrying a POSITION and nothing more.
 *
 * `clientX`/`clientY` are CSS pixels from the surface's origin, and `isPrimary`
 * marks it the primary contact. An engine that also reads `button`, `buttons` or
 * `pointerType` finds them absent and applies its own default — a primary-button
 * contact from an unnamed device, on its edges, in `buttons` and on the `down`
 * and `up` samples it records — so a build reads this press exactly as a
 * player's primary-button press.
 */
export class PointerPositionEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;

  constructor(type: PointerEventType, clientX: number, clientY: number) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
  }
}

/**
 * A `PointerEvent`-shaped event that also names its DEVICE and its buttons.
 *
 * For a case whose specification distinguishes a mouse from a touch or a pen, or
 * one whose checks turn on which button is down. The button mask follows what a
 * real device reports: the primary button is held through the press and every
 * move and gone on the release, and a move names no button at all (`-1`), which
 * is what a browser sends and what an engine's chord tracking expects.
 *
 * `pointerId` is `1` — one contact, the primary one — because a harness that
 * needs two simultaneous contacts is naming them itself and passes its own.
 */
export class DevicePointerEvent extends Event {
  readonly clientX: number;
  readonly clientY: number;
  readonly isPrimary = true;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;

  constructor(
    type: string,
    clientX: number,
    clientY: number,
    device: string,
    pointerId = 1,
  ) {
    super(type);
    this.clientX = clientX;
    this.clientY = clientY;
    this.pointerType = device;
    this.pointerId = pointerId;
    // The primary button, held on a press and a move and gone on a release,
    // which is what a mouse reports and what a touch or a pen in contact does.
    this.button = type === "pointermove" ? -1 : 0;
    this.buttons = type === "pointerup" ? 0 : 1;
  }
}

/** How a surface of a fixed shape reports itself, with no element behind it. */
export interface SurfaceShape {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/**
 * The {@link EngineSurfaceMetrics} an engine harness hands its engine.
 *
 * Byte-identical in every engine harness it was lifted from. It reports one fixed
 * shape and one event target, and carries none of the optional members: there is
 * no element here, so there are no browser gestures to claim and no pointer
 * capture to route, and an engine that reads for them finds them absent and does
 * without — which is exactly what it does over a native canvas in a run.
 */
export function surfaceMetrics(
  shape: SurfaceShape,
  events: EventTarget,
): EngineSurfaceMetrics {
  return {
    cssWidth: () => shape.cssWidth,
    cssHeight: () => shape.cssHeight,
    dpr: () => shape.dpr,
    events: () => events,
  };
}

/**
 * How many frames a synchronous sweep may drive before it lets the loop turn.
 *
 * A sweep of several hundred frames runs entirely inside one `await`, and node's
 * timers, socket reads and the vitest reporter all live on the loop it is
 * holding. Three engine harnesses reinvented this yield independently, at three
 * different intervals; this is the one copy.
 *
 * COUNTED IN FRAMES RATHER THAN MEASURED IN ELAPSED TIME, so the same sweep
 * yields at the same frames on every host and nothing in a harness reads a clock
 * but the one the check supplied. The yield changes no reading either way; what
 * the count buys is that WHEN it happens is a fact about the sweep rather than
 * about the machine.
 */
export const YIELD_AFTER_FRAMES = 60;

/**
 * Let the event loop turn if this sweep has driven at least
 * {@link YIELD_AFTER_FRAMES} frames since it last did, and answer the count to
 * carry into the next stretch.
 *
 * Answers the count rather than keeping one, so a caller threads one number
 * through its loop and pays for a `setImmediate` only when it has actually
 * driven enough frames to owe one.
 */
export async function breathe(framesSinceYield: number): Promise<number> {
  if (framesSinceYield < YIELD_AFTER_FRAMES) return framesSinceYield;
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  return 0;
}
