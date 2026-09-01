// Wick — audio/music-silent-on-title: no bed loops on the title screen.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops: "`music` is
// looping on every frame exactly when `screen` is `playing`, `levelup`,
// `chest`, or `paused` ... `title` and `howto` carry no music." "Exactly
// when" makes the rule two-sided, and `title` falls on the silent side, so
// the threshold is `false` on every frame of it.
//
// WHY THE WORLD IS POSED AS IT IS. `reset` alone, which "Restores every
// declared field of the game's state to its title-screen value: the `title`
// screen with `menuIndex` `0`, the idle run of `specs/state.md` ... A reset
// leaves the game indistinguishable from a freshly started session". That is
// the fresh boot this point is about, and the title is then held for `FRAMES`
// frames with no key pressed, so nothing lights the lamp.
//
// `reset` also states what a bed left running from a previous run must do:
// "Any looping cue stops on the next tick of the game mode, since the state
// it restores holds no run." The trace starts at the frame after the reset,
// which is that tick, so a build that stops the bed there passes and one that
// leaves it running does not.
//
// THE TOLERANCE. None beyond the one frame the specification itself grants
// for the reconciliation, and the reading is a boolean. `FRAMES` (60, one
// second of frames) is a drive length rather than a threshold.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import { captureReplay, createHarness, type Harness } from "../harness";
import { loopTrace } from "./cues";

/** One second of frames on the title. */
const FRAMES = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has music not looping on any frame of the title", async () => {
  h.reset();
  assertEqual(h.snapshot().screen, "title", "the screen reset restored");

  const trace = await captureReplay(h, "silent", () =>
    loopTrace(h, CUES.music, FRAMES),
  );

  assertEqual(
    h.snapshot().screen,
    "title",
    "the screen the title held for the whole span",
  );
  assertEqual(
    trace.filter((looping) => looping).length,
    0,
    `frames of the title on which music was looping, of ${FRAMES} (specs/ui.md, The loops)`,
  );
});
