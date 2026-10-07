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
// THE BED'S NAME IS NOT ASSERTED HERE, THOUGH THIS ENGINE OFFERS IT. `hall-loop`
// and `danger-loop` are both cues on the bus and the announcement carries the
// name, so a check here COULD hold the posed hall to `hall-loop`. This point
// covers all three engines, and an engineless build owns its whole audio layer
// with no bus to ask — so the reading is the one every engine can make: a bed
// runs under a hall the specification puts `hall-loop` under. Which bed it is,
// and the swap on the tick danger arrives, are `audio/danger-bed-swap`'s point,
// which the manifest scopes to the two engines whose bus reports the name.
//
// THE HALL IS POSED SO THAT ONLY A BED CAN SOUND. An EMPTY channel, the inlet
// held (`setEmission(false)`), pressure 0. No insertion, no extraction, no intake
// arrival, no emission, no grant, no swap, no shot — nothing stands in the hall
// that any of them could involve. The level's quota is left where it stands, so
// "A level is cleared the moment its quota is EXHAUSTED and no cores remain on
// the channel" never fires and the game stays on `playing`, where `specs/ui.md`
// puts the beds. An empty channel is also never in danger
// (`specs/progression.md`: the condition "holds only while a head exists"), so
// the bed under test is the hall bed and not the danger one.
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
  // One key press: the gesture that lets the engine open its audio, and the
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
    "the loops open under a hall with no cue to raise " +
      "(specs/assets.md: the two beds run through `api.audio.loop`)",
  );
});
