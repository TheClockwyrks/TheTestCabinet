// audio/music-starts-on-run — music is looping on the frame after a fresh run
// starts from the title.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("The loops"): "`music` is looping
// on every frame exactly when `screen` is `playing`, `levelup`, `chest`, or
// `paused`. It starts on the frame a fresh run starts", and "`title` and `howto`
// carry no music." specs/instrumentation.md fixes when a posed or played state
// is answerable for its loops: "Both loops are reconciled from the state on every
// frame, so a state the debug surface posed sounds, one frame later, exactly as
// the same state reached by play." So the title is read silent first, the run is
// started, and the loop is read on the frame after — the frame by which the
// specification has the state reconciled either way.
//
// WHY THE RUN IS STARTED FROM THE TITLE WITH A REAL KEY. specs/ui.md gives
// `LIGHT THE LAMP` as the first item of `TITLE_ITEMS` with "`menuIndex` is `0` on
// arriving", and it "Starts a fresh run ... and sets `screen = playing`".
// specs/controls.md binds `confirm` to `Enter`, and the keyboard belongs to the
// runtime, where "a dispatched keyboard event ... works the menus exactly as a
// player's key does" (specs/instrumentation.md). This is the one point about the
// route into play, so it takes that route rather than posing the screen.
//
// WHY THE TITLE IS READ FIRST. Without it the check would pass on a build whose
// music never stops, which is a different build from one that starts it with the
// run. `reset` restores "the `title` screen", and specs/instrumentation.md adds
// that after a reset "Any looping cue stops on the next frame", which the
// settling frames run.
//
// WHAT IS READ, AND WHY IT IS THE FAIR READING. specs/ui.md: "A looping cue
// sounds through a single source set to loop, from the frame that starts it until
// the frame that stops it", so the injected probe holds a source from its
// `start()` until it is stopped, disconnected, ended, or paused, and this reads
// whether a source of `music` is among them. Nothing about waveform, gain, or
// level is assumed.
//
// THE TOLERANCE. None: a loop is running on the frame or it is not, and the frame
// is exact because the specification names it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isLooping,
  pressConfirm,
  type Harness,
} from "../harness";
import { SETTLE_FRAMES } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("has music looping on the frame after a run starts from the title", async () => {
  await h.debug.reset();
  await h.step(SETTLE_FRAMES);

  const started = await captureReplay(h, "started", async () => {
    const title = await h.snapshot();
    const onTitle = await isLooping(h, "music");
    const opened = await pressConfirm(h);
    await h.step(1);
    const afterStart = await isLooping(h, "music");
    return { title, onTitle, opened, afterStart };
  });

  assertEqual(
    started.title.screen,
    "title",
    "the screen the reset returned to",
  );
  assertEqual(
    started.onTitle,
    false,
    "music looping on the title before the run",
  );
  assertEqual(
    started.opened.screen,
    "playing",
    "the screen confirming LIGHT THE LAMP opened",
  );
  assertEqual(
    started.afterStart,
    true,
    "music looping on the frame after the fresh run started",
  );
});
