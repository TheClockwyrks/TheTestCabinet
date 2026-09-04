// controls/back-escape — `Escape` leaves the how-to screen.
//
// `specs/controls.md` binds `Escape` to the `back` action AND to `pause`, and
// settles which screens read each: "`back` is read on `title`, `howto`, `paused`,
// and `gameover`, and `pause` is read on `playing` and `paused`. `Escape` raises
// both on one frame, so a single `Escape` press on `playing` pauses once and a
// single `Escape` press on `paused` resumes once." `specs/ui.md` says where
// leaving the how-to screen goes: "Confirming leaves the screen as leaving it
// does, and both return to `title`."
//
// THE DOUBLE BINDING IS THE POINT, FROM THE OTHER SIDE. `controls/pause-escape`
// decides that `Escape` pauses while the game is being played; this decides that
// the SAME key does the other thing everywhere else. A real `Escape` key event
// raises both actions at once, so a build that resolved the ambiguity by taking
// one of them unconditionally passes exactly one of the two items — which is the
// grade that names the fault. Driving the key rather than an action is what puts
// that in front of the build, and it is why this check reaches for the literal
// `KeyboardEvent.code` instead of `harness.ts`'s `tapAction`.
//
// THE HOW-TO SCREEN IS POSED, NOT NAVIGATED TO. `setScreen` is the direct route
// (`specs/instrumentation.md`), and the menu path that also reaches it is
// `screens/howto-reachable`'s requirement rather than this one's: a build whose
// title menu is broken and whose `Escape` works should fail there and pass here.
// `reset` first, so the screen is posed over a field with nothing on it.
//
// AND THE SCREEN IS THE KEY'S DOING. A quarter second is driven on the how-to
// screen first with nothing down, and the screen is read at the end of it: a
// build that walks off it on a timer rather than on a press is caught there
// rather than passing here.
//
// WHAT THIS DOES NOT DECIDE. What the how-to screen SHOWS
// (`screens/howto-shows-the-controls`), how it is reached
// (`screens/howto-reachable`), that the title's highlight is back at its first
// entry afterwards (`screens/howto-returns` reads the same transition through
// the named action), and what `Escape` does in play (`controls/pause-escape`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this point is about, as `specs/controls.md`'s table names it. */
const KEY = "Escape";

/** The quiet stretch driven on the how-to screen before the press, in ticks. */
const QUIET_TICKS = ticksFor(0.25);

/** Frames driven after the press for the still alone, in ticks. */
const PICTURE_TICKS = ticksFor(0.25);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when Escape is pressed on the how-to screen", async () => {
  // The how-to screen, posed over the empty field a fresh `reset` leaves.
  resetTo(h);
  h.debug.setScreen("howto");

  await h.advance(QUIET_TICKS);
  const before = h.snapshot().screen;

  await h.tap(KEY);
  const after = h.snapshot().screen;

  await h.advance(PICTURE_TICKS);
  captureStill(h, "back");

  assertEqual(
    before,
    "howto",
    `the screen after ${String(QUIET_TICKS)} ticks on the how-to screen with ` +
      "no key down, posed through setScreen (specs/instrumentation.md) — the " +
      "screen is left only on a press (specs/controls.md)",
  );
  assertEqual(
    after,
    "title",
    `the screen on the tick ${KEY} was pressed on the how-to screen — Escape ` +
      "leaves the screen on anything but live play (specs/controls.md), and " +
      "leaving the how-to screen returns to the title (specs/ui.md)",
  );
});
