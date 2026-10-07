// Wireworm — screens/pause-freezes-phase-timer: the phase timer does not run
// while the game is paused.
//
// `specs/ui.md` on the `paused` screen: the board "is frozen: no worm steps, no
// foe moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THIS IS THE LEAK WITH THE WORST CONSEQUENCE. `specs/progression.md` counts the
// `banner` and `respawn` timers down against every update's delta, so a build
// whose timer runs behind the menu gives the player's paused level away without
// a frame of it being played.
//
// THE PHASE POSED IS `banner`, the phase a level opens on and the one whose
// timer is longest at `BANNER_TIME` (`1.3` s, specs/progression.md). It is posed
// with `setPhase` and `setPhaseTimer` rather than reached by clearing a level, so
// what is graded is the freeze rather than the route.
//
// THE PAUSED STRETCH IS FAR LONGER THAN THE TIMER IT WATCHES: three whole
// banners of it, so a build that leaked even a third of the stretch has run the
// banner out and moved the phase on.

import { afterEach, beforeEach, it } from "vitest";
import { BANNER_TIME } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  tapAction,
  ticksFor,
  type Harness,
} from "../harness";

/** Live play before the pause: a visible bite out of the banner. */
const LIVE_SECONDS = 0.3;
const LIVE_TICKS = ticksFor(LIVE_SECONDS);

/** The paused stretch the freeze is read over: three whole banners of it. */
const PAUSED_TICKS = ticksFor(3 * BANNER_TIME);

/** How much of the banner must have burned before the pause to prove it was. */
const BURNED_MIN = 0.5 * LIVE_SECONDS;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds the phase timer through three banners of paused game time", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setPhase("banner");
  h.debug.setPhaseTimer(BANNER_TIME);
  const opened = h.snapshot();
  assertEqual(opened.phase, "banner", "the posed phase");

  await h.advance(LIVE_TICKS);
  await tapAction(h, "pause");
  const at = h.snapshot();

  assertEqual(
    at.screen,
    "paused",
    "the pause key opens the pause screen during live play (specs/ui.md)",
  );
  assertEqual(at.phase, "banner", "the phase the pause landed on");

  // The precondition: the timer really was counting down before the pause.
  assertGreaterThan(
    opened.phaseTimer - at.phaseTimer,
    BURNED_MIN,
    "the banner timer counts down over the live stretch before the pause",
  );

  await h.advance(PAUSED_TICKS);
  captureStill(h, "held");

  const later = h.snapshot();
  assertEqual(later.screen, "paused", "the game is still paused");
  assertEqual(
    later.phase,
    "banner",
    "the phase holds while the game is paused (specs/ui.md)",
  );
  assertEqual(
    later.phaseTimer,
    at.phaseTimer,
    "the phase timer holds while the game is paused (specs/ui.md)",
  );
});
