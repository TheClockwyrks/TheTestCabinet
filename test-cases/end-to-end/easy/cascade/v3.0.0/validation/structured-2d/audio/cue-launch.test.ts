// audio/cue-launch — each card the victory cascade launches plays the launch cue.
//
// specs/audio.md fixes `CUES.launch` (`"launch"`) as the cue played when "the
// cascade launches a card", and governs all ten with one sentence: "Each is
// played on the frame its event happens and at most once on that frame."
//
// THIS IS THE ONE CUE WHOSE EVENT HAPPENS INSIDE A FRAME. A launch is the game's
// own tick doing it: specs/victory.md says the launch clock "adds the frame's
// delta" and that "while it holds at least `LAUNCH_INTERVAL` and cards remain to
// be launched, `LAUNCH_INTERVAL` is subtracted from it and the next card
// launches". So this point reads the FRAME NUMBER as well as the count, which the
// nine cues raised by an operation between frames cannot be held to (`cues.ts`).
//
// The measurement is: pose the `won` screen with ONE card on the foundations and
// the launching faculty gated off, run a quiet lead during which no card can
// leave, then set the launch clock to a whole `LAUNCH_INTERVAL` and let the
// faculty back on for exactly one frame. specs/victory.md fixes that frame's
// outcome: the clock holds a whole interval, so one card launches on it and the
// remainder carried is far short of a second launch.
//
// WHY THE CLOCK IS POSED RATHER THAN ACCUMULATED. A build is free to begin its
// cascade at the win or on entering the `won` screen; both reach the same table
// in play, and specs/ does not choose between them. Posing the clock makes the
// frame under test the same frame under either reading, so the point measures the
// cue rather than the build's idea of when the cascade started.
//
// ONE CARD, SO ONE LAUNCH. A single card on foundation `0` — the foundation the
// cycle starts at (specs/victory.md) — is the smallest world in which a launch
// happens at all: the launch takes it, no card remains, and the trailing quiet
// reads a cascade with nothing left to launch. A full board would launch
// fifty-two cards and turn a reading about ONE cue into a reading about the
// cadence, which is the `cascade` group's requirement.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES, DOUBLE_CLICK_WINDOW, LAUNCH_INTERVAL } from "../constants";
import {
  ACE,
  captureStill,
  createHarness,
  framesFor,
  openTable,
  poseFoundation,
  watchCues,
  type Harness,
} from "../harness";
import { playedSince } from "./cues";

/**
 * Frames of silence driven on the posed table before the launch, and again after
 * it.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the
 * longest span this case fixes anywhere — the launch interval, the only other
 * duration in the case, is `0.18` s (specs/victory.md). So a build that sounds a
 * cue on any period the case names has to cross a window longer than its own
 * period without sounding anything.
 */
const QUIET = framesFor(DOUBLE_CLICK_WINDOW);

/** The foundation the launch cycle starts at, and the one card standing on it. */
const SUIT = "clubs";
const FOUNDATION = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.launch on the frame the cascade launches a card, once, and not on the quiet frames either side", async () => {
  openTable(h);
  // The launching faculty is held off for the lead, so the quiet below is a
  // cascade that CANNOT launch rather than one that merely has not yet
  // (specs/instrumentation.md).
  h.debug.setLaunching(false);
  h.debug.setScreen("won");
  poseFoundation(h, FOUNDATION, SUIT, ACE);
  const cues = watchCues(h);

  await h.advance(QUIET);
  assertEqual(
    h.snapshot().muted,
    false,
    "posing: the game is not muted, so a cue the build asks for here is one " +
      "it can be heard playing (specs/audio.md)",
  );
  assertEqual(
    h.snapshot().launched,
    0,
    `cards launched over the ${String(QUIET)} frames with the launching ` +
      "faculty off, during which no card leaves the foundations " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    playedSince(cues, 0, CUES.launch),
    0,
    `times CUES.launch played over those ${String(QUIET)} frames, on a ` +
      "cascade that launched nothing (specs/audio.md: a cue is played on the " +
      "frame its event happens)",
  );

  // The window: the one frame the launch clock stands a whole interval on.
  const mark = cues.length;
  h.debug.setLaunchClock(LAUNCH_INTERVAL);
  h.debug.setLaunching(true);
  await h.advance(1);
  const at = h.engine.frame().count;
  captureStill(h, "launch");
  const sounded = playedSince(cues, mark, CUES.launch);

  assertEqual(
    h.snapshot().launched,
    1,
    "cards the cascade launched on the frame its clock stood at a whole " +
      `LAUNCH_INTERVAL (${String(LAUNCH_INTERVAL)} s), which is the launch ` +
      "whose cue this point reads (specs/victory.md)",
  );
  assertLength(
    h.snapshot().flyers,
    1,
    "cards in flight after that frame, the one the launch put there " +
      "(specs/victory.md)",
  );
  assertLength(
    sounded,
    1,
    "times CUES.launch played across that frame, which plays it once and at " +
      "most once on it (specs/audio.md)",
  );
  assertEqual(
    sounded[0].frame,
    at,
    "the frame CUES.launch played on, which is the frame the card launched " +
      "on (specs/audio.md: a cue is played on the frame its event happens)",
  );
  assertGreaterThan(
    sounded[0].gain,
    0,
    "the gain CUES.launch sounded at on an unmuted game, which is what makes " +
      "it a sound the player hears (specs/audio.md)",
  );

  const after = cues.length;
  await h.advance(QUIET);
  assertLength(
    playedSince(cues, after, CUES.launch),
    0,
    `times CUES.launch played over the ${String(QUIET)} frames after it, on a ` +
      "cascade whose foundations are empty and which has nothing left to " +
      "launch (specs/victory.md, specs/audio.md)",
  );
});
