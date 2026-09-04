// Wick — audio/loop-single-source: a looping cue sounds through one source.
//
// WHERE THE THRESHOLD COMES FROM. `specs/ui.md`, The loops:
// "`world.audio.loop` starts a cue looping, `world.audio.stop` ends it, and
// `world.audio.looping` reports whether it is; a file-backed cue loops its
// decoded buffer seamlessly, and a cue is either looping or not." A cue that
// is EITHER looping or not has one sound running while it loops, so the
// threshold is exactly one source on every frame of a bed that is up. The
// same section fixes what the bed does over a run: "It starts on the frame a
// fresh run starts and keeps playing through the overlays and the pause",
// and `specs/ui.md` fixes when it is up at all: "`music` is looping on every
// frame exactly when `screen` is `playing`, `levelup`, `chest`, or `paused`."
// A bed that is up on every frame of a span therefore started before the span
// and was never stopped inside it, so the count of starts inside the span is
// zero.
//
// WHAT THIS DECIDES THAT THE OTHER LOOP POINTS DO NOT. "Both loops are
// reconciled from the state on every frame", so a build asks for the bed on
// every frame of a run. Those repeats have to change nothing. Two ways of
// getting the bed wrong leave `looping` reading `true` on every frame and
// would pass every other loop point in this directory:
//
//   - starting a second sound beside the first, so the night gathers a chorus
//     of overlapping beds, which the per-frame source count catches;
//   - stopping and restarting the bed on every frame, which is a bed that
//     never plays past its first sixtieth of a second and is the opposite of
//     "loops its decoded buffer seamlessly", which the count of starts inside
//     the span catches.
//
// So two things are read: how many sources of the cue the audio graph has
// running, which is the observable form of "either looping or not", and how
// many times the cue was announced as starting during a span it was up for
// the whole of.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated `playing` run holding nothing,
// with every driver switch off, so no ending, overlay, or pause interrupts
// the bed over the span and the screen conjunct holds on every one of the
// `FRAMES` (120) frames. The bed is let up before the span opens, so a start
// announced inside the span is a restart rather than the first start.
//
// A second start request is then made directly of the bus — the same call
// `specs/ui.md` gives the game, `world.audio.loop` — while the cue is
// looping, and the count is read again: "a cue is either looping or not", so
// the request has to leave one source running rather than adding another.
//
// THE TOLERANCE. None: one is the count "either looping or not" fixes, zero
// is the count of starts a bed that "keeps playing" makes inside a span it
// never left, and the frames are whole.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { CUES } from "../constants";
import { captureReplay, createHarness, onCue, type Harness } from "../harness";
import { heard, isolatedRun } from "./cues";

/** The span the review item drives: two seconds of frames. */
const FRAMES = 120;

/** How many sources of `cue` the audio graph has running right now. */
function sources(h: Harness, cue: string): number {
  return h.liveLoops().filter((loop) => loop.cue === cue).length;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("has one source of the bed running across the span, started once, and unchanged by a second start", async () => {
  await isolatedRun(h);
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was up on playing before the span",
  );

  const played = onCue(h);
  const counts = await captureReplay(h, "single", async () => {
    const trace: number[] = [];
    for (let frame = 0; frame < FRAMES; frame += 1) {
      await h.advance(1);
      trace.push(sources(h, CUES.music));
    }
    return trace;
  });

  assertEqual(
    h.snapshot().screen,
    "playing",
    "the screen the run held for the whole span",
  );
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was still up at the end of the span",
  );
  assertEqual(
    counts.filter((count) => count !== 1).length,
    0,
    `frames of the span carrying other than one source of the bed, of ${FRAMES} (specs/ui.md, The loops)`,
  );
  assertEqual(
    heard(played, CUES.music),
    0,
    `times the bed was sounded afresh inside ${FRAMES} frames it kept playing through (specs/ui.md, The loops)`,
  );

  h.world.audio.loop(CUES.music);
  await h.advance(1);
  assertEqual(
    sources(h, CUES.music),
    1,
    "sources of the bed after a second start request while it loops (specs/ui.md, The loops)",
  );
  assertEqual(
    h.looping(CUES.music),
    true,
    "whether the bed was still looping after the second start request",
  );
});
