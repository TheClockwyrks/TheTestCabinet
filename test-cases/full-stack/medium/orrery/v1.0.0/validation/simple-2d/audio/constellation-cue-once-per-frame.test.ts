// audio/constellation-cue-once-per-frame — one frame that consumed at several
// boundaries sounds `constellation` once, not once per boundary.
//
// THE RULE. `specs/ui.md` bounds a cue by the FRAME rather than by the event:
// each one-shot cue is "played on the frame its event happens, from `update`, and
// AT MOST ONCE ON THAT FRAME, HOWEVER MANY OF THE EVENT FIRED WITHIN IT". The
// event itself is already plural — "| `constellation` | `CUES.constellation` | A
// set consumes ONE OR MORE constellations. |" — and `specs/simulation.md` lets a
// frame hold many boundaries: "A frame may complete several cycles; each runs in
// full, in order", the fraction advancing by "`SPEEDS[sim.speed] * dt` cycles"
// with `SPEEDS` of `[1, 3, 10, 30]`.
//
// HOW ONE CUE IS TOLD FROM THREE, ON ALL THREE ENGINES. Under either engine the
// cue bus announces a name; under no engine a check can hear only that a frame
// sounded and how much (`scenario.ts`, `cuesOf`). So the reading is a COMPARISON
// between two frames of the same run, of the same cue: one frame that consumed
// ONE constellation, and one frame that consumed several. A build that sounds
// once per frame sounds the same on both; a build that sounds once per
// consumption sounds several times as much on the second. Neither figure is
// compared against a literal, because what one cue costs a build in sound sources
// is the build's business.
//
// THE CONFIGURATION. `BARE` — one reagent and one product, both a lone `sol` —
// opened as a bare run at SPEED STEP `3`, which is `SPEEDS[3]` (`30`) cycles a
// second, with a machine that delivers on a cadence of its own:
//
//   * the rise for reagent `0` on `(1, 0)`, which spawns a `sol` there whenever
//     the hex is vacant;
//   * the set for product `0` on `(0, 1)`, which accepts a lone `sol` there;
//   * an `arm` on `(0, 0)` at rotation `0`, whose gripper stands at
//     `(0, 0) + DIRS[0]` = `(1, 0)` (`specs/parts.md`), carrying the tape
//     `grab`, `rotate-cw`, `drop`, `rotate-ccw` — the shortest complete carrying
//     cycle, which lands the mote on `(0, 1)` and comes back for the next one.
//
// So a delivery happens every four cycles, and one long frame covers several of
// them. The completion switch is held off, so the run does not end part way
// through.
//
// THE VERDICT. A frame that consumed once and a frame that consumed several times
// are found by reading the tally, so both are boundaries the build really ran.
// The second frame's tally rise is more than one, and its sound is exactly what
// the first frame's was.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { CUES, RECORDING_RUN_UP, RECORDING_SETTLE, SPEEDS } from "../constants";
import { armPart, risePart, setPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  pauseRun,
  resumeRun,
  tallyOf,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  driveUntil,
  openSilence,
  soundingFrames,
  soundsOnFrame,
} from "./silence";

/** Which of the challenge's products this set receives. */
const PRODUCT = 0;

/** The speed step the long frame is driven at: `SPEEDS[3]` is 30 cycles a second. */
const FAST = 3;

/** How many cycles the one long frame covers: three of the machine's deliveries. */
const LONG_FRAME_CYCLES = 12;

/** A rise, a set one rotation step away, and the arm that carries between them. */
const DELIVERY_MACHINE = solution([
  risePart(0, 1, 0),
  setPart(0, 0, 1),
  armPart("arm", 0, 0, 0, 1, ["grab", "rotate-cw", "drop", "rotate-ccw"]),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds no more for a frame that consumed several than for one that consumed once", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: DELIVERY_MACHINE,
    speed: FAST,
    paused: true,
  });
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.constellation),
    0,
    "the paused run crosses no boundary, so nothing sounds before the resume",
  );
  await resumeRun(h);

  // One frame at a time until the machine's first delivery: a frame that consumed
  // exactly one constellation, which is this check's measure of one cue.
  const single = await driveUntil(
    h,
    (snapshot) => (tallyOf(snapshot, PRODUCT) ?? 0) > 0,
    12,
  );
  assertGreaterThan(single, 0, "the machine delivered its first product");
  const afterSingle = await h.snapshot();
  assertEqual(
    tallyOf(afterSingle, PRODUCT),
    1,
    "and that frame consumed exactly one constellation",
  );
  const oneCue = soundsOnFrame(heard, single);
  assertGreaterThan(
    oneCue,
    0,
    "that frame really sounded, so the measure is a sound rather than a silence",
  );

  // Then one frame long enough to cover several more deliveries.
  // The recording brackets the long frame with the run HELD either side of it: a
  // paused run "advances no fraction" (`specs/simulation.md`), so the run-up and
  // the settle cross no boundary and consume no constellation, and what a reviewer
  // watches is the machine before the frame and the field the frame left.
  const many = await captureReplay(h, "once", async () => {
    await pauseRun(h);
    await h.advance(RECORDING_RUN_UP);
    await resumeRun(h);
    await h.advanceSeconds(LONG_FRAME_CYCLES / SPEEDS[FAST], 1);
    const long = h.frame();
    await pauseRun(h);
    await h.advance(RECORDING_SETTLE);
    return long;
  });

  const afterMany = await h.snapshot();
  const rise = (tallyOf(afterMany, PRODUCT) ?? 0) - 1;
  assertGreaterThan(
    rise,
    1,
    "the one long frame covered several boundaries at which a constellation was consumed",
  );
  assertEqual(
    soundsOnFrame(heard, many),
    oneCue,
    "and it sounds what a frame that consumed one sounds: at most once on that frame, however many fired within it",
  );
});
