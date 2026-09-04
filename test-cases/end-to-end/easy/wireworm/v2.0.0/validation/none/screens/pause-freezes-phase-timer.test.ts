// Wireworm — screens/pause-freezes-phase-timer: the phase timer does not run
// while the game is paused.
//
// specs/ui.md's `paused` screen: the board "is frozen: no worm steps, no foe
// moves, no bolt travels, and no phase timer runs, so nothing on the board
// raises a cue and a paused game is exactly where it was when it was paused."
// Each of those four is its own point, because a build can stop one and leak
// another and the grade has to say which.
//
// THIS ONE DECIDES THE PHASE TIMER, and it is the leak with the worst
// consequence: `specs/progression.md` counts the `respawn` and `banner` timers
// down against every update's delta, so a build whose timer runs behind the menu
// gives the player's paused level away without a frame of it being played.
//
// THE PHASE POSED IS `banner`, which is the phase a level opens on
// (`specs/progression.md`) and the one whose timer is longest at
// `BANNER_TIME` (`1.3` s). It is posed with `setPhase` and `setPhaseTimer` rather
// than reached by clearing a level, so what is graded is the freeze rather than
// the route.
//
// THE PAUSED STRETCH IS FAR LONGER THAN THE TIMER IT WATCHES. Three times
// `BANNER_TIME` passes behind the menu, so a build that leaked even a third of it
// has run the banner out and moved the phase on.
//
// The board is empty and `startPlaying` shuts the three world gates, so nothing
// but the pause decides what the timer does.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertGreaterThan } from "../assert";
import { BANNER_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  startPlaying,
  type Harness,
} from "../harness";
import { PAUSE_KEY } from "./screens";

/** The live frames driven before the pause: a visible bite out of the banner. */
const LIVE_FRAMES = framesFor(0.3);

/** The paused game time the freeze is read over: three whole banners of it. */
const PAUSED_SECONDS = 3 * BANNER_TIME;

/**
 * How much of the banner must have burned before the pause for the reading after
 * it to mean anything, in seconds.
 *
 * Half of what the live stretch covers: far above any rounding, and far below
 * what a conforming build burns.
 */
const BURNED_MIN = 0.5 * 0.3;

/**
 * How closely a frozen timer must be reported where it was, in decimal places.
 *
 * Six places is a tolerance of `5e-7` s — the freeze is exact, and this is room
 * for nothing but the JSON round trip out of the page.
 */
const FROZEN_DIGITS = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("holds the phase timer where it was through three banners of paused time", async () => {
  await startPlaying(h);
  await h.debug.setPhase("banner");
  await h.debug.setPhaseTimer(BANNER_TIME);
  const posed = await h.snapshot();
  assertEqual(posed.phase, "banner", "the posed phase");

  await h.advance(LIVE_FRAMES);
  await h.tap(PAUSE_KEY);
  const atPause = await h.snapshot();
  assertEqual(atPause.screen, "paused", "the screen the pause key left");

  // The precondition: the timer really was counting down when the pause landed.
  assertGreaterThan(
    posed.phaseTimer - atPause.phaseTimer,
    BURNED_MIN,
    "the banner timer had counted down before the pause",
  );
  assertEqual(atPause.phase, "banner", "the phase the pause landed on");

  await h.skip(PAUSED_SECONDS);
  await captureStill(h, "held");

  const after = await h.snapshot();
  assertEqual(after.screen, "paused", "the screen after the paused stretch");
  assertEqual(
    after.phase,
    "banner",
    "the phase after the paused stretch (specs/ui.md)",
  );
  assertCloseTo(
    after.phaseTimer,
    atPause.phaseTimer,
    FROZEN_DIGITS,
    "the phase timer after the paused stretch (specs/ui.md)",
  );
});
