// Carom — controls-versus/escape: pressing `Esc` during a Versus match pauses it.
//
// `Escape` is bound to the engine's `pause` action (specs/modes/versus.md).
//
// `Escape` deliberately drives TWO actions — `pause` and `back` — and the game
// reads whichever the screen calls for, so a real `Escape` key event raises both
// edges at once and a live match must resolve it as the pause. Dispatching the
// key rather than the action is what puts that ambiguity in front of the build,
// which is the whole of what this item is about.
//
// The match is started from the title with real key events and then played into a
// live rally — past the pre-serve hold, so what is paused is a match in flight
// rather than its countdown, which is the `gameplay/pause-during-countdown`
// item's separate point. The key event is dispatched at the target the engine
// listens on, so the action is raised by the binding the case declares rather
// than by anything this check reaches into.

import { afterEach, beforeEach, expect, it } from "vitest";
import { createHarness, startWithKeys, type Harness } from "../harness";

/** Past the 1.0 s pre-serve hold and into a live rally: 1.3 s at 120 Hz. */
const RALLY_TICKS = 156;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("pauses a live Versus match when Escape is pressed", async () => {
  await startWithKeys(h, "versus");
  await h.advance(RALLY_TICKS);
  expect(h.snapshot().screen).toBe("playing");

  await h.tap("Escape");
  expect(h.snapshot().screen).toBe("paused");

  // And it stays paused: the press opened a screen, it did not blink one.
  await h.advance(84);
  expect(h.snapshot().screen).toBe("paused");
});
