// instrumentation/stop-run — the call that puts the machine back in the editor.
//
// THE RULE. "`stopRun()` | Returns `sim` to `null` and the machine to the editor,
// exactly as the run-stop sequence of `specs/simulation.md` does"
// (`specs/instrumentation.md`, The run). And that sequence: "Stopping a run, from
// the `back` action in any sim status, discards the motes and every runtime pose
// and returns to editing with the machine exactly as it was placed"
// (`specs/simulation.md`, The run).
//
// THREE THINGS ARE READ. `sim` reports `null`, which is its resting value while
// editing and is what carries the motes, the poses and the grips away with it —
// the snapshot holds every one of them under `sim`, so a `sim` of `null` is the
// whole of "discards the motes and every runtime pose". The screen is still the
// editor, and the challenge is still open, because this returns to editing rather
// than leaving it. And the machine is the machine that was PLACED: its rest poses
// and its tapes, unchanged by the cycle that moved its live ones.
//
// THE RUN IS MOVED FIRST, ON PURPOSE. A whole cycle is run before the stop, so the
// live poses have left the rest poses behind — the arm has turned one step and the
// piston has grown one hex — and the check reads that separation while the run is
// still live. Without it, "the machine stands exactly as it was placed" would be
// satisfied by a build whose run never moved anything.
//
// THE MACHINE IS COMPARED WITH ITSELF, through `readSolution`, "the current machine
// as a solution document, exactly what `loadSolution` would accept to rebuild it".
// A document read during the run and the same document read after the stop are two
// readings of the build's own machine in a format `specs/formats.md` fixes, so
// comparing them names any part, pose, path or tape the stop disturbed.
//
// THE WORLD IS POSED, NOT SEARCHED. A posed challenge, a machine of exactly two
// parts, the completion switch held off and an emptied field, with one mote
// spawned back for the arm to carry and its hold given by `setGrip`, "which takes
// hold with no `grab` ever running". The piston's tape extends and then retracts,
// so the one cycle run here cannot reach the bound `extend` faults at.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertDeepEqual,
  assertEqual,
  assertLength,
  assertNotNull,
  assertNull,
} from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN } from "../constants";
import { turnDirection } from "../field";
import {
  advanceCycles,
  captureStill,
  createHarness,
  openBareRun,
  partById,
  partIds,
  poseOf,
  readMachine,
  spawnMote,
  stopRun,
  takeGrip,
  type Harness,
} from "../harness";
import { BARE, EAST, ORIGIN } from "../fixtures";
import { armPart, solution } from "../formats";
import { gripperHex } from "../parts";

/** The piston's rest length: one below the bound, so `extend` is legal once. */
const PISTON_LENGTH = ARM_MAX_LEN - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("returns sim to null and leaves the machine exactly as it was placed", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, 0, ARM_MIN_LEN, ["rotate-cw"]),
      armPart("piston", EAST.q, EAST.r, 0, PISTON_LENGTH, [
        "extend",
        "retract",
      ]),
    ]),
  });
  const [arm, piston] = await partIds(h);
  const carried = await spawnMote(
    h,
    gripperHex(ORIGIN, 0, ARM_MIN_LEN),
    "dust",
  );
  await takeGrip(h, arm as number, 0, carried);

  const placed = await readMachine(h);
  await advanceCycles(h, 1);

  const running = await h.snapshot();
  assertNotNull(running.sim, "the run is live before it is stopped");
  assertEqual(
    poseOf(running, arm as number)?.rotation,
    turnDirection(0, 1),
    "the cycle turned the arm's live rotation one step clockwise",
  );
  assertEqual(
    poseOf(running, piston as number)?.length,
    PISTON_LENGTH + 1,
    "the cycle raised the piston's live length by one",
  );
  assertEqual(
    partById(running, arm as number)?.rotation,
    0,
    "the machine's rest rotation is unchanged by the cycle that moved the live one",
  );
  assertLength(
    running.sim?.motes ?? [],
    1,
    "the field holds the one mote the check spawned",
  );

  await stopRun(h);

  await h.advance(1);
  await captureStill(h, "stopped");

  const stopped = await h.snapshot();
  assertNull(
    stopped.sim,
    "stopRun returns sim to null, carrying the motes, the poses and the grips with it",
  );
  assertEqual(
    stopped.screen,
    "editor",
    "stopRun returns the machine to the editor",
  );
  assertNotNull(
    stopped.challenge,
    "stopping a run returns to editing rather than leaving the editor",
  );

  assertLength(
    stopped.editor.parts,
    2,
    "the machine stands with both parts it was placed with",
  );
  const restingArm = partById(stopped, arm as number);
  assertNotNull(restingArm, "the arm is still on the machine");
  assertEqual(
    restingArm?.rotation,
    0,
    "the arm stands at the rotation it was placed at",
  );
  assertEqual(
    restingArm?.length,
    ARM_MIN_LEN,
    "the arm stands at the length it was placed at",
  );
  assertDeepEqual(restingArm?.tape, ["rotate-cw"], "the arm keeps its tape");
  const restingPiston = partById(stopped, piston as number);
  assertNotNull(restingPiston, "the piston is still on the machine");
  assertEqual(
    restingPiston?.length,
    PISTON_LENGTH,
    "the piston stands at the length it was placed at, not the one the cycle gave it",
  );
  assertDeepEqual(
    restingPiston?.tape,
    ["extend", "retract"],
    "the piston keeps its tape",
  );

  assertDeepEqual(
    await readMachine(h),
    placed,
    "the machine reads back as the document it stood as while the run was live",
  );
});
