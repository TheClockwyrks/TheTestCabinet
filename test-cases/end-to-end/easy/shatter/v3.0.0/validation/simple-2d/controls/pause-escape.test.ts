// controls/pause-escape — `Escape` pressed during live play gives the paused
// screen.
//
// THE RULE. `specs/controls.md` binds `Escape` to BOTH the `back` action and the
// `pause` action, and says outright how a build resolves that: "`Escape` drives
// both `back` and `pause`, and the screen decides which one applies: it pauses
// while the game is being played and leaves the screen otherwise." The action table
// agrees from the other side — `back` reads "Pause" in the playing column and
// "Leave the screen" in the menu column. `specs/ui.md` names the screen it reaches,
// `paused`, "the pause menu, over the frozen field".
//
// THE AMBIGUITY IS THE POINT. One physical `Escape` arms two actions at once, and
// on this screen only one of them has a meaning; a build must resolve that by the
// screen it is on rather than by whichever branch it wrote first. Pressing the real
// key is what puts the ambiguity in front of the build; raising a "pause" by any
// other route would decide it for the build and grade nothing. A build that read
// the press as "leave the screen" and went back to the title fails here, which is
// exactly the fault this item exists to name — and `controls/back-escape` is the
// same key on the other side of the rule.
//
// THE KEY IS A REAL ONE. `tap` presses the key, runs the frame that delivers it,
// releases it, and runs one more, all as `KeyboardEvent`-shaped events at the event
// target the engine listens on, which the engine's input contract states drives an
// action exactly as a player's key does. That contract also makes a press "news for
// exactly one frame", so a build reading the armed edge answers in the first of the
// two frames and a build that latched it answers in the second: both are read.
// `specs/instrumentation.md` gives the debug surface no keyboard operation at all,
// so the whole route from the key to the paused screen is the one a player takes.
//
// IT OPENS A SCREEN, IT DOES NOT BLINK ONE. The game is left running for most of a
// second after the press, so a build that pauses on the press and resumes on the
// release — reading the key as a level rather than as the press edge
// `specs/controls.md` requires — is caught rather than photographed at its one
// paused tick.
//
// WHAT THIS ITEM DOES NOT DECIDE. That the paused field is FROZEN
// (`screens/pause-freezes-the-field`), what the pause menu shows
// (`screens/pause-menu-entries`), or where any of its entries lead. Only that this
// key, on this screen, opens that screen.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS } from "../constants";
import { assertContains, assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The key this item decides, and the action `specs/controls.md` binds it to. */
const KEY = "Escape";
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

it("pauses a game in play when Escape is pressed", async () => {
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
    "the screen Escape gave a game in play",
  );

  await h.advance(PAUSED_TICKS);
  assertEqual(
    h.snapshot().screen,
    "paused",
    "the screen still showing seven tenths of a second after the press",
  );
});
