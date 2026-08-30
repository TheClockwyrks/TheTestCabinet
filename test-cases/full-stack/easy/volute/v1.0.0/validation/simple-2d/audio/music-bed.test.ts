// Volute — audio/music-bed: a bed runs under a run in play.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/ui.md` ("The music beds"): "`hall-loop` and `danger-loop` are the
//     two beds, and they loop until stopped rather than playing once. Exactly one
//     of them is looping on `playing`", and the table puts `hall-loop` under
//     every condition but danger.
//   - `specs/ui.md` ("Audio"): "`api.audio.loop` starts a cue looping,
//     `api.audio.stop` ends it, and `api.audio.looping` reports whether it is."
//   - `specs/assets.md` ("The sound"): `hall-loop` is produced with `music`, and
//     "The two music beds are each authored to loop cleanly."
//   - `specs/progression.md` ("Danger"): "The run is in danger while the head's
//     `s` is at least 4000... an empty channel and an interlude are never in
//     danger." The hall posed below stands one lone core far short of that, so
//     the bed the specification asks for here is `hall-loop`.
//
// WHAT IS THEREFORE ASSERTED. That the build has a cue looping under the hall.
// The harness counts the loops the engine's bus has open, from the starts and the
// stops it announces, which is exactly the thing `specs/assets.md` asks for: "run
// the two beds through `api.audio.loop` and `api.audio.stop`". Reading only that
// a sound was MADE would not decide the point: `specs/ui.md` has the beds "loop
// until stopped rather than playing once", and a cue played once makes a sound
// and stops. The hall below is arranged so that no cue in `specs/ui.md`'s table
// can fire, so the only loop the hall can hold open is a bed, and a build with
// none fails.
//
// THE BED'S NAME IS NOT ASSERTED, THOUGH THIS ENGINE OFFERS IT. `hall-loop` and
// `danger-loop` are both cues on the bus and the announcement carries the name,
// so a check here COULD hold the posed hall to `hall-loop`. An engineless build
// owns its whole audio layer and has no bus to ask, and the three validator
// projects of this case decide the same eighty-three points, so the reading is
// the one every engine can make: a bed runs under a hall the specification puts
// `hall-loop` under, and the reviewer decides by ear that it is the hall's and
// not the danger bed.
//
// THE HALL IS POSED SO THAT ONLY A BED CAN SOUND. One lone core, the inlet
// stopped (`quotaRemaining` 0), pressure 0. No insertion, no extraction
// (`MIN_RUN` is 3 and there is one core), no intake arrival, no emission, no
// grant, no swap, no shot. And not an EMPTY hall, because "A level is cleared the
// moment its quota is exhausted and no cores remain on the channel" — an empty
// one would clear on the first tick and move the game off `playing`, where
// `specs/ui.md` says neither bed loops.
//
// AUDIO IS ARMED BY THE ENTER PRESS THAT STARTS THE RUN. "Muting and the
// first-gesture unlock belong to the engine", which opens its audio context on
// the first key or pointer event it sees, and `specs/controls.md` has `confirm`
// start a run from the title with `Enter` among its keys — so one key press at
// the engine's own event target is both the gesture and the start.
//
// TOLERANCE. None on the reading — a bed either sounds under the hall or it does
// not, and this asserts presence, never a level, a duration, or a waveform. The
// spans chosen are drive lengths: the bed is waited for one tick at a time
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
  // One key press: the gesture that lets the engine open its audio, and the
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
      "(specs/assets.md: the two beds run through `api.audio.loop`)",
  );
});
