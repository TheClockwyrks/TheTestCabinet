// audio/halt-cue-on-a-collision — a collision, which freezes a run PART WAY
// THROUGH a cycle rather than at a boundary, sounds `halt` once, on the frame it
// froze.
//
// THE RULE. `specs/ui.md`: "| `halt` | `CUES.halt` | A run faults. |", played "on
// the frame its event happens, from `update`, and at most once on that frame".
// `specs/simulation.md` puts a collision inside the motion step rather than at
// its ends: "`COLLISION_SAMPLES` is `8`. Within the motion step, every mote's
// position is evaluated at the sample fractions `t = k / 8` for `k` from `1` to
// `8`, in order. If at any sample the distance between the centers of two motes
// is strictly less than `2 * MOTE_COLLIDE_R` (`38`), the run faults as
// `collision` at that sample", and "a `collision` leaves the fraction at that
// sample's `k / 8`". That is what makes this fault worth its own point: the frame
// it lands on is one of the frames in the middle of a cycle, decided by the
// geometry rather than by the clock.
//
// THE CONFIGURATION is worked example A of `specs/simulation.md`, quoted: "An arm
// at `(0, 0)`, length 1, carries a mote from `(1, 0)` toward `(0, 1)` with
// `rotate-cw`. A mote rests on `(1, 1)`." First sample within `38`: `36.10` at
// `t = 3/8`. Outcome: faults. The hold is given with `setGrip`, "which takes hold
// with no `grab` ever running", so the only cycle that runs is the one under
// test, and the run is opened PAUSED so the whole of the fault happens inside the
// check's window.
//
// WHICH FRAME THE FAULT IS ON. The check drives the cycle one frame at a time and
// reads `sim.status` after each, so the frame the status became `faulted` is
// named by the snapshot rather than computed from the sample fraction. The cue is
// then judged against that frame.
//
// THE VERDICT. The fault is a `collision` frozen at `t = 3/8` — read back, so the
// frame under judgement is the one the specification's geometry chose — and the
// halt cue sounds on that frame, on no frame before it and on none after.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertNear,
} from "../assert";
import { CUES, FRACTION_TOLERANCE, sampleFraction } from "../constants";
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

/** The sample example A first comes within `38` on: `36.10` at `t = 3/8`. */
const FIRST_WITHIN = 3;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds halt once, on the frame the collision froze the cycle", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([armPart("arm", 0, 0, 0, 1, ["rotate-cw"])]),
    paused: true,
  });
  const [arm] = await partIds(h);
  const carried = await spawnMote(h, at(1, 0), "dust");
  await takeGrip(h, arm ?? -1, 0, carried);
  await spawnMote(h, at(1, 1), "dust");
  await openSilence(h);

  const heard = watchCues(h);
  await h.advance(FENCE_FRAMES);
  assertLength(
    soundingFrames(heard, CUES.halt),
    0,
    "the paused run advances nothing, so nothing sounds before the resume",
  );

  const frozen = await captureReplay(h, "collided", async () => {
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
    "the cycle froze within itself: example A comes within 38 before its boundary",
  );
  const sim = (await h.snapshot()).sim;
  assertEqual(
    sim?.status,
    "faulted",
    "two mote centers strictly closer than 2 * MOTE_COLLIDE_R (38) fault the run",
  );
  assertEqual(sim?.fault?.kind, "collision", "and the fault is a collision");
  assertNear(
    sim?.fraction ?? -1,
    sampleFraction(FIRST_WITHIN),
    FRACTION_TOLERANCE,
    "frozen at the first sample within 38, which example A puts at t = 3/8 rather than at a boundary",
  );
  assertDeepEqual(
    soundingFrames(heard, CUES.halt),
    [frozen],
    "the halt cue sounds on the frame the run froze, on no frame before it, and on none after",
  );
});
