// audio/fire — firing a bolt plays the fire cue.
//
// specs/ui.md fixes `CUES.fire` (`"fire"`) as the cue played when "a bolt is
// fired", and governs all ten with one sentence: "Each is played on the frame its
// event happens and at most once on that frame."
//
// So the measurement is: hold the real fire key on an otherwise silent board, step
// one frame at a time, and read what sounded on the frame the bolt appeared
// against what sounded on the frames before it. The frames before are the half a
// build cannot fake, and the quiet lead is a whole `FIRE_INTERVAL` long, so a
// build that blips at the firing cadence rather than on the firing is caught by
// the silence that should have preceded the first shot.
//
// THE BOLT IS FIRED, NOT PLACED. `addBolt` puts a bolt in flight without firing
// one, so it would never raise this cue. The key held here is the one
// specs/controls.md binds the `a` action to, and the shot is the build's own
// firing path answering it.
//
// THE BOARD IS EMPTY AND QUIET. `startPlaying` leaves no node, no worm, no foe and
// no bolt, and the three world gates shut, so the only event in the whole scenario
// is the shot: nothing else on the board can raise a cue of any name during the
// lead, and the bolt climbs a column with nothing in it to resolve against.
//
// WHAT THIS DOES NOT DECIDE. That a held fire action produces a bolt every
// `FIRE_INTERVAL`, and that the bolt spawns above the cursor, are
// `cursor.fire-interval`'s and `cursor.bolt-spawns-at-cursor`'s requirements. This
// point reads the cue alone.

import { afterEach, beforeEach, it } from "vitest";
import { BINDINGS, CUES, FIRE_INTERVAL } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { cuesBeforeEvent, cuesOnEvent, watchForEvent } from "./cues";

/** The key specs/controls.md binds the `a` action, which fires a bolt, to first. */
const FIRE_KEY = BINDINGS.a[0];

/**
 * Frames of silence driven before the key goes down.
 *
 * A whole `FIRE_INTERVAL` (`0.15` s), which is the shortest gap specs/cursor.md
 * allows between two shots. A build that sounds the cue on a timer rather than on
 * a shot has to get through a window as long as its own firing period without
 * sounding anything, so the quiet this reads across is exactly as long as the
 * cadence it is separating the shot from.
 */
const QUIET_LEAD = ticksFor(FIRE_INTERVAL);

/**
 * Frames the held key is given to produce the first bolt.
 *
 * specs/cursor.md fires "whenever the cooldown is at `0` and fewer than
 * `MAX_BOLTS` bolts are in flight", and `startPlaying` leaves the cooldown at `0`
 * with no bolt in flight, so a conforming build fires on the first update the
 * action is held. Two whole fire intervals is a hard ceiling many times that, so a
 * build that is merely slow off the mark still reaches a verdict here rather than
 * running the suite out.
 */
const FIRE_FRAMES = ticksFor(2 * FIRE_INTERVAL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.fire on the frame the fired bolt appears, and not before", async () => {
  startPlaying(h);
  assertEqual(
    h.snapshot().bolts.length,
    0,
    "posing: the board carries no bolt before the fire key goes down " +
      "(specs/instrumentation.md)",
  );

  let watch;
  try {
    watch = await watchForEvent(
      h,
      (s) => s.bolts.length > 0,
      QUIET_LEAD + FIRE_FRAMES,
      { quietLead: QUIET_LEAD, arm: () => h.hold(FIRE_KEY) },
    );
  } finally {
    h.release(FIRE_KEY);
  }
  captureStill(h, "shot");

  assertEqual(
    watch.hit,
    true,
    `a bolt appeared inside the ${String(FIRE_FRAMES)} frames the ` +
      `${FIRE_KEY} key was held for, from a cooldown of 0 with no bolt in ` +
      "flight (specs/cursor.md)",
  );
  assertEqual(
    cuesBeforeEvent(watch, CUES.fire),
    0,
    `times CUES.fire played over the ${String(watch.at - 1)} frames before ` +
      "the bolt appeared, on a board carrying nothing at all " +
      "(specs/ui.md: a cue is played on the frame its event happens)",
  );
  assertEqual(
    cuesOnEvent(watch, CUES.fire),
    1,
    "times CUES.fire played on the frame the fired bolt appeared, which is " +
      "its own frame and at most once on it (specs/ui.md)",
  );
});
