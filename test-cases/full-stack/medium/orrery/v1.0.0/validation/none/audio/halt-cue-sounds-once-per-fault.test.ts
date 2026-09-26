// audio/halt-cue-sounds-once-per-fault — a run that has faulted sounds `halt` no
// more, however long it is left running.
//
// THE RULE. `specs/ui.md` gives the cue one event — "| `halt` | `CUES.halt` | A
// run faults. |" — and one moment: "played on the frame its event happens".
// `specs/simulation.md` says the event happens once: "A fault freezes the run
// where it stood: the status becomes `faulted` and NOTHING ADVANCES FURTHER."
// A frozen run is not faulting again, so the frames after it are frames with no
// event on them. The clock rule says it from the other side: "The fraction
// advances only while the status is `running`."
//
// WHY THIS IS ITS OWN POINT. A build that plays the cue from a CONDITION — while
// the status is `faulted` — rather than from the transition sounds it on every
// frame after the fault, and passes every check that only asks whether the fault
// sounded. This one is about the frames that follow.
//
// THE CONFIGURATION. `BARE` opened as a bare run, PAUSED, with one part on the
// field: a piston on `ORIGIN` at rest length `1` whose tape is a single
// `retract`, which `specs/simulation.md`'s fault table faults as `overretracted`
// at the fetch. The field holds no motes, so no collision and no tear is
// available to raise a second fault. Once it has faulted the run is left for
// several cycles' worth of game time — long enough that a per-frame cue would be
// heard dozens of times.
//
// THE VERDICT. Exactly one frame sounds across the whole window: the frame the
// status became `faulted`. The run is still `faulted`, on the same cycle, at the
// end of it, so the time really passed.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertGreaterThan } from "../assert";
import { CUES } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceCycles,
  captureReplay,
  createHarness,
  openBareRun,
  placePart,
  resumeRun,
  watchCues,
  writeTape,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  driveUntil,
  openSilence,
  soundingFrames,
} from "./silence";

/** How much game time the frozen run is left to run for, in cycles. */
const FROZEN_CYCLES = 6;

let h: Harness;

beforeEach(async () => {
  // ARMED AT CREATION, because this suite reads what the build SOUNDED and a
  // browser opens no audio context without a user gesture: unarmed, `openSilence`
  // below would find the page's silence rather than the build's. The press of
  // `INERT_KEY` goes in before the harness's opening `reset`, whose restore puts
  // back anything it touched, so it costs this check nothing — see `silence.ts`.
  h = await createHarness({ armAudio: true });
});

afterEach(async () => {
  await h.dispose();
});

it("sounds halt on one frame only, however long the frozen run is left", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  const piston = await placePart(h, "piston", ORIGIN, 0);
  await writeTape(h, piston, ["retract"]);
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  await resumeRun(h);
  const frozen = await driveUntil(
    h,
    (snapshot) => snapshot.sim?.status !== "running",
    1,
  );
  assertGreaterThan(
    frozen,
    0,
    "the run faulted at the fetch of its first cycle",
  );
  const atFault = await h.snapshot();
  assertEqual(
    atFault.sim?.status,
    "faulted",
    "the frozen state this check listens over is a faulted run",
  );

  const after = await captureReplay(h, "frozen", async () => {
    await advanceCycles(h, FROZEN_CYCLES);
    return h.snapshot();
  });

  assertEqual(
    after.sim?.status,
    "faulted",
    "six cycles of game time later the run is still frozen",
  );
  assertEqual(
    after.sim?.cycle,
    atFault.sim?.cycle,
    "and it advanced no cycle, so what the frames covered was a frozen run",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.halt),
    [frozen],
    "one fault sounds one halt: no frame after the freeze sounds it again",
  );
});
