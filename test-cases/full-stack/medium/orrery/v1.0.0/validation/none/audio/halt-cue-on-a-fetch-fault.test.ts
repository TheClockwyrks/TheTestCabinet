// audio/halt-cue-on-a-fetch-fault — a fault raised at the fetch sounds `halt`,
// once, on the frame the status becomes `faulted`.
//
// THE RULE. `specs/ui.md` fixes the cue and its event: "| `halt` | `CUES.halt` | A
// run faults. |", played "on the frame its event happens, from `update`, and at
// most once on that frame". `specs/simulation.md` names the fetch faults —
// `impossible`, `overextended`, `overretracted`, `unmounted`, `track-end` — and
// puts them at step 1 of the cycle: "Fetch. Each part reads its tape cell for this
// cycle ... A non-blank cell the part cannot perform raises the fault named for it
// under Faults." A fault "freezes the run where it stood: the status becomes
// `faulted` and nothing advances further".
//
// THE CONFIGURATION. `BARE` opened as a bare run, PAUSED, with one part on the
// field: a piston on `ORIGIN` at rest length `1` whose tape is a single
// `retract`. `specs/simulation.md`'s fault table gives that exactly one outcome —
// "`overretracted` | `retract` on a piston already at `ARM_MIN_LEN` (`1`)" — and
// the field is empty of motes, so no collision and no tear is available to raise
// anything else. The run is paused while the machine is posed and the audio
// settles, so the whole of the fault happens inside the window the check is
// listening to.
//
// WHICH FRAME THE FAULT IS ON. The fetch is the first step of the cycle, so the
// first frame that advances the fraction is the frame the fault is raised on.
// This check drives exactly ONE frame after the resume and reads `sim.status`
// there: the frame the status became `faulted` is named by the snapshot rather
// than assumed, and the cue is judged against it.
//
// THE VERDICT. The frames before the resume are silent — "on no frame before it".
// The one frame that faulted sounds, it is the only frame that ever sounds, and
// the fault it raised is the fetch fault the tape asked for.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { CUES, FRAMES_PER_CYCLE } from "../constants";
import { BARE, ORIGIN } from "../fixtures";
import {
  advanceFraction,
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
  TAIL_FRAMES,
  openSilence,
  soundingFrames,
} from "./silence";

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

it("sounds halt once, on the frame the fetch fault froze the run", async () => {
  await openBareRun(h, { challenge: BARE, paused: true });
  const piston = await placePart(h, "piston", ORIGIN, 0);
  await writeTape(h, piston, ["retract"]);
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertEqual(
    (await h.snapshot()).sim?.status,
    "paused",
    "the paused run advances nothing, so the frames before the resume raise no fault",
  );
  assertLength(
    soundingFrames(heard, CUES.halt),
    0,
    "and nothing sounds on them",
  );

  const faulted = await captureReplay(h, "faulted", async () => {
    await resumeRun(h);
    await advanceFraction(h, 1 / FRAMES_PER_CYCLE, 1);
    const frame = h.frame();
    const sim = (await h.snapshot()).sim;
    await h.advance(TAIL_FRAMES);
    return { frame, status: sim?.status, kind: sim?.fault?.kind };
  });

  assertEqual(
    faulted.status,
    "faulted",
    "the fetch is the first step of the cycle, so the first frame that advances the fraction faults",
  );
  assertEqual(
    faulted.kind,
    "overretracted",
    "retract on a piston already at ARM_MIN_LEN (1) faults as overretracted",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.halt),
    [faulted.frame],
    "the halt cue sounds on the frame the status became faulted, on no frame before it, and on none after",
  );
});
