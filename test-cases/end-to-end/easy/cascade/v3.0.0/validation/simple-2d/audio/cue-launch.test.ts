// audio/cue-launch — the cascade launching a card plays the launch cue.
//
// specs/audio.md fixes `CUES.launch` (`"launch"`) as the cue played when "the
// cascade launches a card", and governs all ten with one sentence: "Each is played
// on the frame its event happens and at most once on that frame."
//
// So the measurement is: win the game so the cascade is standing ready, hold the
// launching faculty OFF for a quiet lead during which the cascade cannot launch
// anything, then pose the launch clock at `LAUNCH_INTERVAL`, turn launching back
// on, and run exactly ONE frame. specs/victory.md adds that frame's delta to the
// clock, which then holds at least `LAUNCH_INTERVAL`, so exactly one card launches
// on it — the remainder left behind is one frame of time, far below a second
// interval — and this point reads what sounded on that frame against what sounded
// on the frames before it.
//
// THE CARD IS LAUNCHED BY THE CASCADE, NOT POSED. `addFlyer` puts a card in flight
// without the cascade launching one, so it would never raise this cue, and every
// pose runs between frames with no route to the engine's audio bus (`harness.ts`).
// The launch read here is the build's own cascade taking its step.
//
// THE WIN IS POSED, NOT PLAYED. `startCascade` sends the last card home through the
// surface's `move`, which applies the game's own rules but runs no frame, so the
// `win` that move raised sounds nothing and the whole scenario carries exactly one
// audible event: the launch. `audio/cue-win` reads the other cue, on its own.
//
// THE LAUNCH CLOCK IS POSED RATHER THAN INHERITED. specs/instrumentation.md has
// `setLaunching` gate "the cascade's launch clock and the launching of the next
// card", so a held clock keeps its value; posing it at `LAUNCH_INTERVAL` before the
// gate reopens means this point does not rest on how a build stored a clock it was
// not allowed to advance, and the one frame that follows is a launch under the rule
// specs/victory.md states rather than under a build's own bookkeeping.
//
// `trailPainting` IS HELD OFF. The painted layer is no part of this requirement,
// and specs/instrumentation.md gates it exactly so a check exercises only the
// faculties it is about.
//
// WHAT THIS DOES NOT DECIDE. The cadence launches arrive at, which foundation each
// one is taken from, and the velocity a launched card carries are the `cascade`
// group's requirements. This point reads the cue alone, and asks of the launch only
// that a card left a foundation for the flight.

import { afterEach, beforeEach, it } from "vitest";
import {
  CUES,
  DOUBLE_CLICK_WINDOW,
  LAUNCH_INTERVAL,
} from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  startCascade,
  watchCues,
  type Harness,
} from "../harness";
import { frameWith, playedBefore, playedOn } from "./cues";

/**
 * Frames of silence driven on the won table while launching is held off.
 *
 * A whole `DOUBLE_CLICK_WINDOW` (`0.30` s, specs/controls.md), which is the longest
 * span this case fixes anywhere and longer than `LAUNCH_INTERVAL` (`0.18` s,
 * specs/victory.md), the cadence the cascade launches at. So a build that sounds
 * `launch` on the cascade's own timer rather than on a launch has to cross more
 * than a whole period of that timer without sounding anything.
 */
const QUIET_LEAD = framesFor(DOUBLE_CLICK_WINDOW);

/** Cards in flight before the gate reopens, and after the one frame that follows. */
const NO_FLYERS = 0;
const ONE_FLYER = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("plays CUES.launch on the frame the cascade launches a card, and not before", async () => {
  const cues = watchCues(h);
  startCascade(h);
  h.debug.setLaunching(false);
  h.debug.setTrailPainting(false);
  assertEqual(
    h.snapshot().screen,
    "won",
    "posing: the last card home moved the game to the won screen, which is " +
      "where the cascade runs (specs/victory.md)",
  );
  await h.advance(QUIET_LEAD);
  assertEqual(
    h.snapshot().flyers.length,
    NO_FLYERS,
    "posing: nothing launched over the quiet lead, because the launching " +
      "faculty was held off across it (specs/instrumentation.md)",
  );

  h.debug.setLaunchClock(LAUNCH_INTERVAL);
  h.debug.setLaunching(true);
  const at = await frameWith(h);
  captureStill(h, "launch");

  assertEqual(
    h.snapshot().flyers.length,
    ONE_FLYER,
    "cards in flight after one frame of a cascade whose launch clock held " +
      `${String(LAUNCH_INTERVAL)} s, which is the launch whose cue this point ` +
      "reads (specs/victory.md)",
  );
  assertEqual(
    playedBefore(cues, at, CUES.launch),
    0,
    `times CUES.launch played over the ${String(QUIET_LEAD)} frames of the ` +
      "won screen before the gate reopened, while nothing could launch " +
      "(specs/audio.md: a cue is played on the frame its event happens)",
  );
  assertEqual(
    playedOn(cues, at, CUES.launch),
    1,
    "times CUES.launch played on the frame the cascade launched its card, " +
      "which is its own frame and at most once on it (specs/audio.md)",
  );
});
