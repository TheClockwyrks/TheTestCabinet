// audio/saucer-arrival-cue — the cue a saucer arriving plays.
//
// `specs/audio.md` fixes `saucer` (`CUES.saucer`) as the cue played when "A saucer
// arrives on the field", on the tick its event happens.
//
// THE ARRIVAL IS THE GAME'S OWN, NOT A POSED ONE. `addSaucer(x, y)` "brings a
// saucer onto the field" as a pose — a precondition a check arranges — and posing
// one is not the game deciding a saucer has arrived. So the world gate this point
// is really about is opened instead: `setSaucerSpawning(true)` leaves the game's
// own arrival running, "at `SAUCER_FIRST_DELAY` and at the gaps after it"
// (`specs/instrumentation.md`), and the tick the build's own cadence puts a saucer
// in the slot is the tick the cue must sound on.
//
// THE CLOCK IS MARCHED, THE ARRIVAL IS WATCHED. `specs/saucer.md` puts the first
// arrival of a game `SAUCER_FIRST_DELAY` (`18` seconds) of game time in, which is
// two thousand ticks of nothing. Sixteen and a half seconds of it are skipped —
// the same real ticks, run in one crossing, filmed by nothing — and the three
// seconds around the arrival are then driven one tick at a time, so the sound can
// be attributed to the tick that produced it. The second and a half of driven
// silence before the arrival is what a build that blips on a timer is caught by.
//
// THE FIELD IS EMPTY AND STAYS EMPTY. `startPlaying` shuts the wave loop, so
// nothing spawns over the eighteen seconds and no rock can reach the star, the
// ship, or a wave clear; the ship sits at rest at the safe point with its contact
// gate shut. The saucer's own arrival is the only thing left that can happen, which
// is what makes "nothing sounded before it" a reading rather than a hope.
//
// WHAT THIS DOES NOT DECIDE. When the saucer arrives, which is
// `saucer/first-arrives-at-18s`'s; where it enters, which is
// `saucer/enters-at-an-edge`'s; and the cue's NAME, which is not observable from
// outside an engineless build at all (`./cues.ts`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertNull } from "../assert";
import { SAUCER_FIRST_DELAY } from "../constants";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { soundsBeforeEvent, soundsOnEvent, watchForEvent } from "./cues";

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

afterEach(async () => {
  await h.dispose();
});

it("sounds on the tick a saucer joins the field, and not on the run-up to it", async () => {
  await startPlaying(h);
  // A genuine, browser-trusted gesture: an engineless build's audio does not start
  // until the player has interacted with the page (`specs/audio.md`), and the key
  // is bound to nothing (`specs/controls.md`).
  await h.armAudio();
  // The one faculty this point is about, back on. Everything else `startPlaying`
  // shut stays shut.
  await h.debug.setSaucerSpawning(true);

  await h.skip(MARCH_TICKS);
  const marched = await h.snapshot();
  assertNull(
    marched.saucer,
    `no saucer on the field ${String(SAUCER_FIRST_DELAY - LEAD_SECONDS)}s into ` +
      `the game, against the ${String(SAUCER_FIRST_DELAY)}s specs/saucer.md gives ` +
      "the first arrival — an arrival inside the march is one this point could " +
      "not hear",
  );

  const arrival = await watchForEvent(h, (s) => s.saucer !== null, WATCH_TICKS);
  await captureStill(h, "arrival");

  assertEqual(
    arrival.hit,
    true,
    `a saucer arrived inside the ${String(WATCH_TICKS)} ticks around ` +
      `${String(SAUCER_FIRST_DELAY)}s, with the game's own arrival running ` +
      "(specs/saucer.md)",
  );
  assertEqual(
    soundsBeforeEvent(arrival),
    0,
    `sounds the build emitted over the ${String(arrival.at - 1)} ticks before the ` +
      "saucer joined the field, on an empty field with a ship at rest, on which " +
      "specs/audio.md names no event",
  );
  assertGreaterThanOrEqual(
    soundsOnEvent(arrival),
    1,
    "sounds the build emitted on the tick the saucer joined the field — a saucer " +
      "arriving plays CUES.saucer on that tick (specs/audio.md)",
  );
});
