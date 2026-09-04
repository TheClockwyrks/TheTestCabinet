// Cascade — the keyboard, which this game uses for exactly one thing.
//
// Cascade is played with a pointer (specs/controls.md), so the keyboard carries
// no game control at all. The one key it answers is the backtick that shows and
// hides the debug overlay, and that key belongs to the runtime rather than to the
// game (specs/instrumentation.md).
//
// This module is therefore small on purpose: it normalizes a DOM event into a
// `KeyboardEvent.code`, and it holds a watch list of the codes the runtime cares
// about. A build that later needed named actions would grow them here.

/** The part of a `KeyboardEvent` this build reads. */
export interface KeyLike {
  /** The physical key, as `KeyboardEvent.code`. */
  readonly code: string;
  /** Whether the event came from auto-repeat rather than a fresh press. */
  readonly repeat?: boolean;
}

/**
 * An event as a key this build answers, or `null` when it is not one.
 *
 * An auto-repeat is dropped: a held backtick would otherwise flicker the panel
 * on and off many times a second.
 */
export function asKeyboardEvent(event: Event): KeyLike | null {
  const candidate = event as unknown as Partial<KeyLike>;
  if (typeof candidate.code !== "string") return null;
  if (candidate.repeat === true) return null;
  return candidate as KeyLike;
}

/** A watch over a set of `KeyboardEvent.code` values. */
export class KeyWatcher {
  private readonly handlers = new Map<string, () => void>();

  /** Answer `code` with `handler`. Re-registering a code replaces it. */
  on(code: string, handler: () => void): void {
    this.handlers.set(code, handler);
  }

  /** Whether any code is watched. */
  get size(): number {
    return this.handlers.size;
  }

  /**
   * Deliver one event, and report whether it was answered.
   *
   * A handler that throws is not allowed to escape into the DOM listener that
   * called it, because a broken panel toggle must not take the page's event
   * dispatch down with it.
   */
  handle(event: Event): boolean {
    const key = asKeyboardEvent(event);
    if (key === null) return false;
    const handler = this.handlers.get(key.code);
    if (handler === undefined) return false;
    try {
      handler();
    } catch {
      // A key handler cannot fail the page.
    }
    return true;
  }
}
