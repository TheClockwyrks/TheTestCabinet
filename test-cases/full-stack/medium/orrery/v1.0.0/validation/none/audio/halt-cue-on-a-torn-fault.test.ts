// audio/halt-cue-on-a-torn-fault — a tear, which is decided at the START of the
// motion step rather than at a fetch or a sample, sounds `halt` once, on the
// frame the status becomes `faulted`.
//
// THE RULE. `specs/ui.md`: "| `halt` | `CUES.halt` | A run faults. |", played "on
// the frame its event happens, from `update`, and at most once on that frame".
// `specs/simulation.md` puts the tear at its own moment in the cycle: "AT THE
// START OF THE MOTION STEP, every held constellation's imposed motions must
// agree: each holding gripper imposes the motion of its own part's instruction,
// and unless every imposed motion is the same one, the run faults as `torn`", and
// the cycle order names it there too — "Motion. The moving parts sweep across the
// cycle ... with the torn check at its start and the collision check at each
// sample." A fault "freezes the run where it stood".
//
// THE CONFIGURATION. `BARE` opened as a bare run, PAUSED, with one mote on
// `(1, 0)` held by two grippers whose parts disagree:
//
//   * an `arm` on `(0, 0)` at rotation `0`, whose gripper stands at
//     `(0, 0) + DIRS[0]` = `(1, 0)` (`specs/parts.md`), with `rotate-cw`;
//   * an `arm` on `(2, 0)` at rotation `3`, whose gripper stands at
//     `(2, 0) + DIRS[3]` = `(1, 0)`, with a blank tape, "which every part rests
//     on".
//
// No motion and a rotation are not the same motion, so the motions disagree.
// Every hold is given with `setGrip`, "which takes hold with no `grab` ever
// running", so no earlier cycle moved anything, and ONE mote is on the field, so
// no pair exists for the collision rule to sample and the tear is the only fault
// available.
//
// WHICH FRAME THE FAULT IS ON. The check drives the cycle one frame at a time and
// reads `sim.status` after each, so the frame the status became `faulted` is
// named by the snapshot rather than assumed. The cue is judged against it.
//
// THE VERDICT. The fault is a `torn` — read back — and the halt cue sounds on the
// frame the run froze, on no frame before it and on none after.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
} from "../assert";
import { CUES } from "../constants";
import { at } from "../field";
import { armPart, solution } from "../formats";
import { BARE } from "../fixtures";
import {
  captureReplay,
  createHarness,
  openBareRun,
  partIds,
  resumeRun,
  spawnMote,
  takeGrip,
  watchCues,
  type Harness,
} from "../harness";
import {
  FENCE_FRAMES,
  TAIL_FRAMES,
  driveUntil,
  openSilence,
  soundingFrames,
} from "./silence";

/** The hex the one held mote rests on; both grippers stand there. */
const HELD = at(1, 0);

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

it("sounds halt once, on the frame the tear froze the run", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", 0, 0, 0, 1, ["rotate-cw"]),
      armPart("arm", 2, 0, 3, 1, []),
    ]),
    paused: true,
  });
  const placed = await partIds(h);
  const mote = await spawnMote(h, HELD, "dust");
  await takeGrip(h, placed[0] ?? -1, 0, mote);
  await takeGrip(h, placed[1] ?? -1, 3, mote);

  const posed = await h.snapshot();
  assertLength(
    posed.sim?.grips ?? [],
    2,
    "the turning arm and the resting arm both hold the one mote before the cycle begins",
  );

  await openSilence(h);
  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.halt),
    0,
    "the paused run advances nothing, so nothing sounds before the resume",
  );

  const frozen = await captureReplay(h, "torn-halt", async () => {
    await resumeRun(h);
    const frame = await driveUntil(
      h,
      (snapshot) => snapshot.sim?.status !== "running",
      1,
    );
    await h.advance(TAIL_FRAMES);
    return frame;
  });

  assertGreaterThan(
    frozen,
    0,
    "the cycle faulted rather than reaching its boundary",
  );
  const sim = (await h.snapshot()).sim;
  assertEqual(
    sim?.status,
    "faulted",
    "a fault freezes the run where it stood and the status becomes faulted",
  );
  assertEqual(
    sim?.fault?.kind,
    "torn",
    "no motion and a rotation are not the same motion, so the held constellation is torn",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.halt),
    [frozen],
    "the halt cue sounds on the frame the status became faulted, on no frame before it, and on none after",
  );
});
