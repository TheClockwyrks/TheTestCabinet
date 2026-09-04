// Spectra — controls/pause-escape: pressing `Escape` in a live wave opens the paused
// screen.
//
// THE RULE. `specs/controls.md` binds the `pause` action to `Escape` and `KeyP`,
// reads it as a press EDGE, lists it among the actions the `inWave` screen reads,
// and says in as many words that "`pause` on the `inWave` screen opens the paused
// screen". This point decides one half of that binding: that the physical key
// `Escape` is one of the keys which drives it. `controls/pause-p` decides the other.
//
// ONE KEY, TWO ACTIONS, AND THE SCREEN DECIDES. `Escape` drives `back` AND `pause`,
// and `specs/controls.md` settles the collision with its table of what each screen
// reads: the `inWave` screen reads `pause` and does not read `back`. Both actions
// are registered against the key and the build reads both every frame, so a real
// `Escape` raises both readings at once and a live wave must resolve it as the
// pause — which is what pressing the physical key, rather than raising an action,
// puts in front of the build. `controls/back-escape` decides the same key's other
// reading, on the how-to-play screen.
//
// WHAT IS ASSERTED, AND WHAT IS NOT. That the press moved the game to the `paused`
// screen, and that it STAYED there — a press that opened the screen and let the next
// frame close it again has not paused anything, and the second half costs nothing to
// check because the clock is the harness's. What the paused screen draws is
// `screens/pause-menu-items`'s; that the field behind it is frozen is
// `screens/pause-freezes`'s; that the pause key pressed again resumes is
// `controls/pause-resumes`'s. None of them is restated here.
//
// THE KEY IS TAPPED, AND IT IS A REAL ONE. `specs/controls.md` reads `pause` as an
// edge, so a conforming build resolves it through the engine's `pressed`: `tap`
// presses the key, releases it, and runs the one frame that delivers the armed edge,
// which is exactly what the engine's input frame carries. The event is a
// `KeyboardEvent`-shaped one dispatched at the engine's own event target, which the
// engine resolves exactly as it resolves a player's key, so the whole path from a
// physical key to an opened screen — the registration included — is exercised. The
// code below is the LITERAL `specs/controls.md` states rather than
// `BINDINGS.pause[…]`: that table is the build's own copy of the very thing this
// point decides.
//
// THE WORLD IS EMPTY. `startPosed` clears the four rosters and shuts the wave's
// three gates, so nothing on the field can change the screen underneath the press:
// no contact costs a life and opens the `ready` phase, no wave clears, and the only
// thing that moves the game off `inWave` is the key.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  ticksFor,
  type Harness,
} from "../harness";

/** The key `specs/controls.md` binds the `pause` action to, written out as it states it. */
const KEY = "Escape";

/**
 * How long the game is left on the opened screen before it is read again.
 *
 * Seven tenths of a second, long enough that a screen opened and closed on the
 * following frame shows as something other than `paused` at the end of it. It is a
 * settling window rather than a figure: `specs/ui.md` fixes no hold on the paused
 * screen, which is a screen the player leaves rather than one that times out, so any
 * span at all would do and this one is simply generous.
 */
const SETTLE_SECONDS = 0.7;
const SETTLE_TICKS = ticksFor(SETTLE_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("opens the paused screen from a live wave when Escape is pressed", async () => {
  startPosed(h);
  const before = h.snapshot();
  assertEqual(
    before.screen,
    "inWave",
    "the wave the key is pressed in is live",
  );
  assertEqual(
    before.phase,
    "live",
    "and the ship is flying rather than respawning",
  );

  await h.tap(KEY);
  // Before the assertions, so a check that fails still leaves the picture of the
  // screen the press actually opened.
  captureStill(h, "paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    `the screen one frame after Escape was pressed in a live wave, which ` +
      "specs/controls.md says pause opens",
  );

  await h.advance(SETTLE_TICKS);
  assertEqual(
    h.snapshot().screen,
    "paused",
    `the screen ${String(SETTLE_SECONDS)}s later, still with no key pressed — the ` +
      "press must open a screen rather than blink one",
  );
});
