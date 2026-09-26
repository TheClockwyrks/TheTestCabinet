// Volute — audio/music-bed: a bed runs under a run in play.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("The music beds"): "`hall-loop` and `danger-loop` are the
//     two beds, and they loop until stopped rather than playing once. Exactly one
//     of them is looping on `playing`", and the table puts `hall-loop` under
//     every condition but danger.
//   - `specs/ui.md` (engineless "Audio"): "The layer supports a looping cue:
//     starting a loop plays the cue's file end to end without a gap until the
//     loop is stopped."
//   - `specs/assets.md` (engineless "The sound"): "Decode each `.wav` with the
//     Web Audio API, play a cue on its event, and run the two beds through
//     looping sources." That sentence fixes the MECHANISM for this engine, so a
//     looping source is what the point reads.
//   - `specs/assets.md` ("The sound"): `hall-loop` is produced with `music`, and
//     "The two music beds are each authored to loop cleanly."
//   - `specs/progression.md` ("Danger"): "The run is in danger while the head's
//     `s` is at least 4000... an empty channel and an interlude are never in
//     danger." The hall posed below stands one lone core far short of that, so
//     the bed the specification asks for here is `hall-loop`.
//
// WHAT CAN BE READ FROM OUTSIDE AN ENGINELESS BUILD, AND WHAT CANNOT. Not the
// cue's NAME: `specs/ui.md` hands the whole audio layer to the runtime this build
// writes, so there is no bus to ask which of the two beds is running. `hall-loop`
// and `danger-loop` are therefore indistinguishable from outside, and this point
// decides that a bed is running under a hall the specification puts `hall-loop`
// under — the reviewer decides by ear that it is the hall's and not the danger
// bed. That is a real reduction, and it is the honest one: telling the two apart
// from the waveform would grade a build against the reference's music.
//
// WHAT IS THEREFORE ASSERTED. That the build has a looping source running under
// the hall. `audio-init.js` reports how many of the sources the build has started
// are still live AND set to loop, right now, which is exactly the thing
// `specs/assets.md` asks for. Reading only that a sound was MADE would not decide
// the point: `specs/ui.md` has the beds "loop until stopped rather than playing
// once", and a bed played once makes a sound and stops. The hall below is
// arranged so that no cue in `specs/ui.md`'s table can fire, so the only looping
// source the hall can hold is a bed, and a build with none fails.
//
// THE HALL IS POSED SO THAT ONLY A BED CAN SOUND. An EMPTY channel with the inlet
// held and the pressure at 0. Nothing in `specs/ui.md`'s cue table can fire: no
// core to strike, insert, extract, or carry into the intake, no emission, no
// grant, no swap, no shot. The hall stays on `playing` while it stands empty
// because `poseHall` leaves the quota unexhausted and holds the inlet with
// `setEmission(false)` (`specs/instrumentation.md`) rather than starving it, so
// `specs/progression.md`'s clear condition — "the moment its quota is exhausted
// and no cores remain on the channel" — never fires. An empty channel is also
// never in danger (`specs/progression.md`), which is the condition `specs/ui.md`
// puts `hall-loop` under.
//
// AUDIO IS ARMED BY THE REAL ENTER PRESS THAT STARTS THE RUN. A browser opens no
// audio context without a genuine user gesture, and `specs/controls.md` binds
// `confirm` to `Enter`, which "starts a run" from the title — so one real key
// press through Chromium's own input pipeline is both the gesture and the start.
//
// TOLERANCE. None on the reading — a bed either sounds under the hall or it does
// not, and this asserts presence, never a level, a duration, or a waveform. The
// spans chosen are drive lengths: the bed is waited for one tick per crossing
// rather than read on a fixed tick, because `specs/assets.md` has the build
// decode its own produced `.wav` and a decode's length is a fact about the host,
// not about the build; and a further second of hall is recorded so the evidence
// shows the run playing under it.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  pressConfirm,
  stepUntilBed,
  type Harness,
} from "../harness";

/**
 * A second of the hall recorded once the bed is up, in ticks.
 *
 * The review item's evidence is "The hall loop under a run", so the section
 * recorded has to be the run playing with the bed under it. It also guarantees
 * the recording holds frames at all, since a build whose bed is already running
 * when the probe is first read would otherwise have no tick recorded. Decides
 * nothing.
 */
const BED_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs a looping bed under a run in play", async () => {
  // One real key press: the browser-trusted gesture that lets audio open, and the
  // control `specs/controls.md` binds to starting a run.
  const opened = await pressConfirm(h);
  assertEqual(
    opened.screen,
    "playing",
    "the screen a real confirm press on the title opened",
  );
  await poseHall(h);

  const bed = await captureReplay(h, "music", async () => {
    const looping = await stepUntilBed(h);
    await h.step(BED_TICKS);
    return { looping };
  });

  assertGreaterThan(
    bed.looping,
    0,
    "the looping sources running under a hall with no cue to raise " +
      "(specs/assets.md: the two beds run through looping sources)",
  );
});
