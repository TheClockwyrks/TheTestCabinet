// Spectra — controls/back-escape: `Escape` on the how-to-play screen returns to the
// title.
//
// THE RULE. `specs/controls.md` binds the `back` action — "Leaves the current
// screen." — to `Escape` alone, reads it as a press EDGE, and lists it among the two
// actions the `howto` screen reads. `specs/ui.md` says `back` on that screen "returns
// to `title`". This point decides that binding.
//
// WHY IT IS CAPPED HARDER THAN ITS NEIGHBOURS. `Escape` is `back`'s ONLY key: there
// is no alternate to fall back on, so a build that misses it strands the player on
// the how-to-play screen with no way out.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `Escape` drives `back` AND `pause`,
// and `specs/controls.md` settles the collision with its table of what each screen
// reads: the `howto` screen reads `back` and does not read `pause`. Both actions are
// registered against the key and the build reads both every frame, so a real
// `Escape` raises both readings at once and the how-to screen must resolve it as the
// back — which is what pressing the physical key, rather than raising an action, puts
// in front of the build. `controls/pause-escape` decides the same key's other
// reading, in a live wave.
//
// THE SCREEN IS POSED, NOT NAVIGATED TO. `setScreen("howto")` puts the game on the
// screen this point is about, so the verdict rests on the `back` binding alone.
// Walking there through the title menu instead would fold the confirm binding and the
// menu highlight into this point, and a build whose `confirm` was broken would fail
// this one as well — two points for one fault. Reaching the scenario directly is what
// `specs/instrumentation.md` gives `setScreen` for.
//
// WHAT IS NOT ASSERTED. Where the title's highlight comes back to is
// `screens/howto-returns-selection`'s; what the how-to screen draws is
// `screens/howto-content`'s. This point reads the screen the press arrived at and
// nothing else.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `back` as an
// edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed edge,
// which is exactly what the engine's input frame carries. The event is a
// `KeyboardEvent`-shaped one dispatched at the engine's own event target, which the
// engine resolves exactly as it resolves a player's key, so the whole path from a
// physical key to the title screen — the registration included — is exercised. The
// code below is the LITERAL `specs/controls.md` states rather than
// `BINDINGS.back[0]`: that table is the build's own copy of the very thing this point
// decides.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";

/** The one key `specs/controls.md` binds `back` to, written out as it states it. */
const BACK_KEY = "Escape";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("returns to the title when Escape is pressed on the how-to-play screen", async () => {
  h.debug.setScreen("howto");
  await h.advance(1);
  assertEqual(
    h.snapshot().screen,
    "howto",
    "the screen the press is made on, posed through setScreen",
  );

  await h.tap(BACK_KEY);
  // Before the assertion, so a check that fails still leaves the picture of the
  // screen the press actually arrived at.
  captureStill(h, "returned");

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen one frame after Escape was pressed on the how-to-play screen, " +
      "which specs/ui.md says back returns to",
  );
});
