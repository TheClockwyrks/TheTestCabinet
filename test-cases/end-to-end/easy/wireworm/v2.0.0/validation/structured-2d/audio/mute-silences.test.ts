// Wireworm — audio/mute-silences: with sound muted, the events that would sound
// play nothing at all.
//
// specs/ui.md: "The game binds the `mute` action to the engine's mute bit and
// toggles it from any screen. While sound is muted every cue is silent and the
// game stays fully playable." Mute is reached the way a player reaches it, on the
// real `KeyM` binding (specs/controls.md), because specs/instrumentation.md
// carries no `setMuted`: the bit is the runtime's, and the snapshot's `muted` is
// a live read of it at the call.
//
// WHAT IS READ, AND WHY IT IS READ THIS WAY. Under this engine every play is
// announced as a `cue:played` event carrying the GAIN it played at, so a cue
// sounded while the bus is muted arrives at a gain of zero. But a build is
// equally within specs/ui.md if it checks the bit and never asks for the cue at
// all — silence is silence. So this check does not demand that cues arrive, and
// it does not demand that none do. It demands that nothing AUDIBLE arrives: every
// cue that was announced played at a gain of zero.
//
// That leaves one way for the check to pass on nothing, and it is closed by
// reading the EVENTS from the snapshot instead of from the audio. Three of them
// are driven — a menu highlight moves, a bolt is fired, a bolt destroys a worm
// segment, three separate rows of specs/ui.md's cue table — and each is proved to
// have really happened by the state it left behind: the highlight moved, the bolt
// is in the roster, the worm is a segment shorter. A build that simply did
// nothing fails on those, and a build that muted a flag of its own while leaving
// the runtime's bus running fails on the gains.
//
// `muted` is read back at every stage, so a build whose mute lasts one screen, or
// one frame, is told apart from one that stays muted across the run.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FIRE_INTERVAL, TILE } from "../../src/constants";
import { assertEqual, assertNotEqual } from "../assert";
import {
  captureStill,
  createHarness,
  holdAction,
  poseBoltAtTile,
  poseWorm,
  releaseAction,
  resetTo,
  startPlaying,
  tapAction,
  ticksFor,
  watchCues,
  wormById,
  type Harness,
} from "../harness";

/** The seed the run is posed with; nothing this check reads turns on it. */
const SEED = 1;

/**
 * Where the highlight rests on arriving at the title: the first item
 * (specs/ui.md), counted from `0`.
 */
const FIRST_ITEM = 0;

/**
 * The tile the worm's tail stands on, and the column its bolt climbs.
 *
 * A tile in the middle of the board, clear of row `0`, of the player band's rows
 * `18`–`19`, and of both side edges (specs/board.md) — and in a different column
 * from the cursor's, so the bolt the fire stage put in flight cannot reach it.
 */
const TAIL_C = 12;
const TAIL_R = 10;

/** Rows the worm's bolt is posed below the tail. */
const APPROACH_ROWS = 3;

/**
 * Frames the held fire action is given to produce its bolt.
 *
 * `startPlaying` poses the fire cooldown at `0`, so specs/cursor.md has a bolt
 * due on the first update that reads the action; the window is a whole
 * `FIRE_INTERVAL` (`0.15` s) all the same.
 */
const FIRE_WINDOW_TICKS = ticksFor(FIRE_INTERVAL);

/**
 * Frames the worm's bolt is given to cover its approach.
 *
 * A bolt climbs at `BOLT_SPEED` (`900` units per second, specs/cursor.md), so
 * `APPROACH_ROWS` tiles of `TILE` (`32`) units is `96 / 900` = `0.107` s, and the
 * window is four times that.
 */
const FLIGHT_TICKS = ticksFor((4 * APPROACH_ROWS * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays nothing audible while the mute the M key set is on", async () => {
  resetTo(h, SEED);
  // One frame, so the title has been drawn before the key is pressed on it.
  await h.advance(1);
  assertEqual(
    h.snapshot().muted,
    false,
    "sound starts on, so the press below is what turns it off",
  );

  // The real binding, from the title: mute toggles from any screen (specs/ui.md).
  await tapAction(h, "mute");
  assertEqual(h.snapshot().muted, true, "the M key mutes the runtime's bus");

  // Subscribed after the mute lands, so every cue read below was asked for while
  // the bus was already muted.
  const played = watchCues(h);

  // 1. A menu highlight moves.
  await tapAction(h, "down");
  assertNotEqual(
    h.snapshot().menuIndex,
    FIRST_ITEM,
    "the highlight really moved, so the menu cue's event happened",
  );
  assertEqual(h.snapshot().muted, true, "still muted after the menu move");

  // 2. A bolt is fired.
  startPlaying(h);
  holdAction(h, "a");
  let fired;
  try {
    fired = await h.until((s) => s.bolts.length > 0, {
      maxFrames: FIRE_WINDOW_TICKS,
    });
  } finally {
    releaseAction(h, "a");
  }
  assertEqual(
    fired.hit,
    true,
    "a bolt really went out, so the fire cue's event happened",
  );
  assertEqual(h.snapshot().muted, true, "still muted after the shot");

  // 3. A bolt destroys a worm segment. The fired bolt is cleared first, so the
  // only bolt in flight is the one aimed at the worm.
  h.debug.clearBolts();
  const worm = poseWorm(h, TAIL_C + 1, TAIL_R, 2);
  h.debug.setWormStepping(worm, false);
  poseBoltAtTile(h, TAIL_C, TAIL_R + APPROACH_ROWS);
  const struck = await h.until(
    (s) => (wormById(s, worm)?.segments.length ?? 0) < 2,
    { maxFrames: FLIGHT_TICKS },
  );
  captureStill(h, "muted");
  assertEqual(
    struck.hit,
    true,
    "a segment really went, so the cut cue's event happened",
  );
  assertEqual(h.snapshot().muted, true, "still muted after the cut");

  // Every cue the build asked for while muted, at the gain it played at. A build
  // that asked for none passes here and is held to the three events above; a
  // build that muted a flag of its own and left the bus running fails here.
  for (const cue of played) {
    assertEqual(cue.gain, 0, `the ${cue.cue} cue is silent while muted`);
  }
});
