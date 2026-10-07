// audio/saucer-arrival-cue — the cue a saucer arriving plays.
//
// `specs/audio.md` fixes `saucer` (`CUES.saucer`) as the cue played when "A saucer
// arrives on the field", on the tick its event happens and at most once on it.
//
// THE ARRIVAL IS THE GAME'S OWN, NOT A POSED ONE. `addSaucer(x, y)` brings a
// saucer on as a POSE — a precondition a check arranges — and posing one is not
// the game deciding a saucer has arrived. So the game's own arrival is what runs:
// `reset` leaves `saucerSpawning` on, this check leaves it on, and the tick the
// build's own cadence puts a saucer in the slot is the tick the cue must sound on.
//
// THE GAME IS REALLY OPENED FIRST. `specs/saucer.md` times the first arrival
// "`SAUCER_FIRST_DELAY` (`18` seconds) of game time after the game begins", so the
// scenario begins a game the way a player does — `reset` to the title, then
// `confirm` on `PLAY` — rather than posing the `playing` screen onto a title-screen
// state. A build that arms its cadence when a game OPENS and one that carries it
// from `reset` are then both measured from the moment the specification names,
// which a posed screen would not do for the first of those two.
//
// THE FIELD IS THEN EMPTIED AND HELD EMPTY. The opening wave is taken off with
// `clearRocks` — which destroys nothing and clears no wave (`specs/instrumentation.md`)
// — the wave loop is shut so nothing replaces it, the banner is run out, and the
// ship is put back at the safe point at rest with its contact gate shut. Nothing
// can then reach the star, the ship, or a wave clear, and the saucer's own arrival
// is the only thing left that can happen: that is what makes "nothing sounded
// before it" a reading rather than a hope.
//
// THE CLOCK IS MARCHED, THE ARRIVAL IS WATCHED. Sixteen and a half seconds are
// marched in one crossing — the same real ticks, with the bus read as a whole
// rather than tick by tick, and asserted to have raised no `saucer` cue and put up
// no saucer — and the three seconds around the arrival are then driven one tick at
// a time, so the cue can be attributed to the tick that produced it.
//
// WHAT THIS DOES NOT DECIDE. When the saucer arrives, which is
// `saucer/first-arrives-at-18s`'s; and where it enters, which is
// `saucer/enters-at-an-edge`'s.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  FACE_UP,
  SAFE_X,
  SAFE_Y,
  SAUCER_FIRST_DELAY,
} from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  clearWorld,
  createHarness,
  startRun,
  ticksFor,
  type Harness,
} from "../harness";
import {
  countOf,
  markOf,
  playedBeforeEvent,
  playedOnEvent,
  sinceMark,
  watchForEvent,
} from "./cues";

/**
 * The driven silence required before the arrival, in seconds of game time.
 *
 * A second and a half on a field where `specs/audio.md` names no event at all, so a
 * build that sounds on a timer rather than on the arrival raises something inside
 * it.
 */
const LEAD_SECONDS = 1.5;

/**
 * How far past the specified arrival the watch runs, in seconds of game time.
 *
 * The same margin the other way, so the window is symmetric about
 * `SAUCER_FIRST_DELAY` and a build whose cadence is a little slow still reaches a
 * verdict on the cue rather than on the clock. Whether the arrival is on time is
 * `saucer/first-arrives-at-18s`'s point, not this one's.
 */
const MARGIN_SECONDS = 1.5;

/** The game time marched through before the watch opens, in ticks. */
const MARCH_TICKS = ticksFor(SAUCER_FIRST_DELAY - LEAD_SECONDS);

/** The ticks the arrival is watched for, one at a time. */
const WATCH_TICKS = ticksFor(LEAD_SECONDS + MARGIN_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.saucer on the tick a saucer joins the field, once, and not on the run-up", async () => {
  // A game really begun, which is what specs/saucer.md times the first arrival
  // from, and the one frame the menu's key costs.
  await startRun(h);

  // Everything the point is NOT about, taken off and held off. The saucer's own
  // arrival — the one faculty this point is about — is left running, exactly as
  // `reset` left it.
  clearWorld(h);
  h.debug.setWaveSpawning(false);
  h.debug.setWaveBanner(0);
  h.debug.setShipCollision(false);
  h.debug.setShipPosition(SAFE_X, SAFE_Y);
  h.debug.setShipVelocity(0, 0);
  h.debug.setShipAngle(FACE_UP);

  const opening = markOf(h);
  await h.advance(MARCH_TICKS);
  const march = sinceMark(h, opening);
  const marched = h.snapshot();

  assertNull(
    marched.saucer,
    `no saucer on the field ${String(SAUCER_FIRST_DELAY - LEAD_SECONDS)}s into ` +
      `the game, against the ${String(SAUCER_FIRST_DELAY)}s specs/saucer.md ` +
      "gives the first arrival — an arrival inside the march is one this point " +
      "could not attribute to a tick",
  );
  assertEqual(
    countOf(march.played, CUES.saucer),
    0,
    `times CUES.saucer played over the ${String(MARCH_TICKS)} ticks before the ` +
      "watch opened, on an empty field with no saucer on it — the cue is played " +
      "on the tick a saucer arrives (specs/audio.md)",
  );

  const arrival = await watchForEvent(h, (s) => s.saucer !== null, WATCH_TICKS);
  captureStill(h, "arrival");

  assertEqual(
    arrival.hit,
    true,
    `a saucer arrived inside the ${String(WATCH_TICKS)} ticks around ` +
      `${String(SAUCER_FIRST_DELAY)}s of a game that was really opened, with ` +
      "the game's own arrival running (specs/saucer.md)",
  );
  assertEqual(
    playedBeforeEvent(arrival, CUES.saucer),
    0,
    `times CUES.saucer played over the ${String(arrival.at - 1)} ticks before ` +
      "the saucer joined the field, on an empty field with a ship at rest, on " +
      "which specs/audio.md names no event",
  );
  assertEqual(
    playedOnEvent(arrival, CUES.saucer),
    1,
    "times CUES.saucer played on the tick the saucer joined the field — a cue " +
      "is played on the tick its event happens and at most once on that tick " +
      "(specs/audio.md)",
  );
});
