// Wireworm — audio/fire: firing a bolt plays the `fire` cue, on the frame the
// bolt appears.
//
// specs/ui.md's cue table fixes the event outright — "`fire` | `CUES.fire` | A
// bolt is fired." — and the sentence under it fixes the timing: "Each is played
// on the frame its event happens and at most once on that frame." So what is
// read here is a cue's NAME and a cue's FRAME, and the frame is the one the
// bolt turns up in the roster on.
//
// Cues are the engine's to announce under this engine. The game defines the ten
// names specs/ui.md fixes from its `initialize` and asks for one by name; the
// engine publishes every play as a `cue:played` event, synchronously, from
// inside the call. So a check subscribes and reads what arrived — there is no
// log to poll, no audio device to own, and no unlock gesture to fake, because a
// cue is announced whether or not anything could be heard.
//
// The board is posed empty and the three world gates are shut, so the shot is
// the only thing on it that can sound. A build that blips its cut sound on the
// trigger pull, one that plays the cue a frame after the bolt appears, and one
// that plays nothing at all therefore each read differently from a build that
// plays `fire` once as the bolt leaves.

import { afterEach, beforeEach, it } from "vitest";
import { CUES, FIRE_INTERVAL } from "../constants";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  holdAction,
  releaseAction,
  startPlaying,
  ticksFor,
  watchCues,
  type Harness,
} from "../harness";

/**
 * Frames the held fire action is given to produce its bolt.
 *
 * `startPlaying` poses the fire cooldown at `0` and leaves no bolt in flight, so
 * specs/cursor.md has a bolt due on the first update that reads the action. The
 * window is a whole `FIRE_INTERVAL` (`0.15` s) all the same, which is when the
 * next one would be due at the latest, so a build that spends a frame arming the
 * action is measured on its cue rather than on its reflexes.
 */
const FIRE_WINDOW_TICKS = ticksFor(FIRE_INTERVAL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays the fire cue on the frame the bolt appears", async () => {
  startPlaying(h);
  assertEqual(
    h.snapshot().bolts.length,
    0,
    "the posed board carries no bolt before the shot",
  );

  // Subscribed after the board is posed, so what is read is the shot alone.
  const played = watchCues(h);
  holdAction(h, "a");
  let fired;
  try {
    fired = await h.until((s) => s.bolts.length > 0, {
      maxFrames: FIRE_WINDOW_TICKS,
    });
  } finally {
    // In a `finally`, so a sweep that found nothing does not leave the trigger
    // held down for the teardown.
    releaseAction(h, "a");
  }
  // Read on the frame the sweep stopped, which is the frame the bolt appeared
  // on and therefore the frame the cue owes itself to.
  const frame = h.engine.frame().count;
  captureStill(h, "shot");

  assertEqual(
    fired.hit,
    true,
    "the held fire action puts a bolt in flight (specs/cursor.md)",
  );
  assertDeepEqual(
    played.map((cue) => cue.cue),
    [CUES.fire],
    "the fire cue, once, and nothing else on an otherwise silent board",
  );
  assertEqual(
    played[0].frame,
    frame,
    "the cue plays on the frame the bolt appears (specs/ui.md)",
  );
  assertGreaterThan(
    played[0].gain,
    0,
    "the cue is audible with the bus unmuted",
  );
});
