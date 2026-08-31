// controls/pause-p — `KeyP` pressed during live play gives the paused screen.
//
// THE RULE. `specs/controls.md` binds `KeyP` to the `pause` action, whose playing
// column reads "Pause" and whose menu column is empty, and reads pausing as a press
// edge, "once per press". `specs/ui.md` names the screen it reaches, `paused`, "the
// pause menu, over the frozen field".
//
// WHY IT IS A SEPARATE ITEM FROM `controls/pause-escape`. Two keys pause, and they
// are two entries of the binding table. `KeyP` is also the unambiguous one — it
// drives one action and nothing else, where `Escape` drives two — so a build that
// wired only the ambiguous key, or only the plain one, loses exactly one point
// rather than both or neither.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does — and it is delivered by its `code`, which
// is what makes `KeyP` the PHYSICAL key rather than the character a layout happens
// to put there. That contract also makes a press "news for exactly one frame", so a
// build reading the armed edge answers in the first of the two frames and a build
// that latched it answers in the second: both are read.
//
// IT OPENS A SCREEN, IT DOES NOT BLINK ONE. The game is left running for most of a
// second after the press, so a build that pauses on the press and resumes on the
// release — reading the key as a level rather than as the press edge
// `specs/controls.md` requires — is caught rather than photographed at its one
// paused tick.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the paused field is FROZEN
// (`screens/pause-freezes-the-field`), what the pause menu shows
// (`screens/pause-menu-entries`), or where any of its entries lead.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../../src/constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "KeyP";
const ACTION = "pause";

/** Ticks of live play before the press, so what is paused is a game in motion. */
const LIVE_TICKS = ticksFor(0.4);

/** Ticks held after the press, long enough that a pause that blinked would show. */
const PAUSED_TICKS = ticksFor(0.7);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("pauses a game in play when KeyP is pressed", async () => {
  assertContains(
    BINDINGS[ACTION].keys,
    KEY,
    "the keys specs/controls.md binds the `pause` action to",
  );

  startPlaying(h);
  await h.advance(LIVE_TICKS);
  assertEqual(h.snapshot().screen, "playing", "the screen before the press");

  await h.tap(KEY);
  captureStill(h, "paused");
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen KeyP gave a game in play",
  );

  await h.advance(PAUSED_TICKS);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen still showing seven tenths of a second after the press",
  );
});
