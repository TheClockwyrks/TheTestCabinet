// Volute — audio/music-bed: a bed runs under a run in play.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("The music beds"): "`hall-loop` and `danger-loop` are the
//     two beds, and they loop until stopped rather than playing once. Exactly one
//     of them is looping on `playing`", and the table puts `hall-loop` under
//     every condition but danger.
//   - `specs/assets.md` ("The sound"): the two beds are run "through the world's
//     `audio.loop` and `audio.stop`", and the engine reports a loop from the call
//     that started it until the call that stopped it.
//   - `specs/assets.md` ("The sound"): `hall-loop` is produced with `music`, and
//     "The two music beds are each authored to loop cleanly."
//   - `specs/progression.md` ("Danger"): "The run is in danger while the head's
//     `s` is at least 4000... an empty channel and an interlude are never in
//     danger." The hall posed below stands one lone core far short of that, so
//     the bed the specification asks for here is `hall-loop`.
//
// WHICH BED IS RUNNING IS NOT ASSERTED. `hall-loop` and `danger-loop` are told
// apart by ear, so this point decides that a bed is running under a hall the
// specification puts `hall-loop` under and leaves the identification to the
// reviewer. That keeps the point deciding the same requirement under every engine
// the case supports — under no engine there is no bus to ask which cue is
// looping at all.
//
// WHAT IS THEREFORE ASSERTED. That the build has a cue looping under the hall.
// The harness counts the loops the engine's bus has open, which is exactly the
// thing `specs/assets.md` asks for: the two beds are run "through the world's
// `audio.loop` and `audio.stop`". Reading only that a sound was MADE would not
// decide the point: `specs/ui.md` has the beds "loop until stopped rather than
// playing once", and a cue played once makes a sound and stops. The hall below is
// arranged so that no cue in `specs/ui.md`'s table can fire, so the only loop the
// hall can hold open is a bed, and a build with none fails.
//
// THE HALL IS POSED SO THAT ONLY A BED CAN SOUND. One lone core, the inlet
// stopped (`quotaRemaining` 0), pressure 0. No insertion, no extraction
// (`MIN_RUN` is 3 and there is one core), no intake arrival, no emission, no
// grant, no swap, no shot. And not an EMPTY hall, because "A level is cleared the
// moment its quota is exhausted and no cores remain on the channel" — an empty
// one would clear on the first tick and move the game off `playing`, where
// `specs/ui.md` says neither bed loops.
//
// AUDIO IS ARMED BY THE REAL ENTER PRESS THAT STARTS THE RUN. The engine "opens
// the audio context on the first pointer or key event it sees", and
// `specs/controls.md` binds `confirm` to `Enter`, which "starts a run" from the
// title — so one real key press at the engine's input seam is both the gesture
// and the start.
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
import { CHANNEL_ARC, TICK_HZ, type ChargeId } from "../constants";
import {
  captureReplay,
  createHarness,
  poseHall,
  pressConfirm,
  spacedBlock,
  stepUntilBed,
  type Harness,
} from "../harness";

/**
 * Where the lone core stands: the middle of the leg from vertex 2 to vertex 3.
 *
 * `specs/channel.md` runs that leg along the bottom of the field, and an arc
 * position this low is far short of the danger line at `s = 4000` and of the
 * intake at `s = 5000` — so the run stays out of danger for the whole drive,
 * which is the condition `specs/ui.md` puts `hall-loop` under, and no core
 * reaches the intake to spend a cell.
 */
const QUIET_S = (CHANNEL_ARC[2] + CHANNEL_ARC[3]) / 2;

/** Immaterial: no rule here turns on which of the five charges is posed. */
const QUIET_CHARGE: ChargeId = "halide";

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
  await poseHall(h, { cores: spacedBlock(QUIET_S, 1, QUIET_CHARGE) });

  const bed = await captureReplay(h, "music", async () => {
    const looping = await stepUntilBed(h);
    await h.step(BED_TICKS);
    return { looping };
  });

  assertGreaterThan(
    bed.looping,
    0,
    "the loops open under a hall with no cue to raise " +
      "(specs/assets.md: the two beds run through the world's `audio.loop`)",
  );
});
