// parts/rest-pose-is-the-placed-pose — a run starts every arm and wheel at the
// rotation and length it was PLACED at.
//
// THE RULE. "An arm's placed rotation and length are its rest pose. Each run
// starts every arm at its rest pose" (`specs/parts.md`, Arms), and
// `specs/simulation.md` says the same from the run's side, as the first step of
// Starting a run: "Every arm and wheel takes its rest pose, holding nothing, and
// every wheel's six fixtures appear on its spoke hexes."
// `specs/instrumentation.md` fixes it for the operation this check starts the run
// with: "`startRun()` — Runs the game's run-start sequence of
// `specs/simulation.md`: every arm and wheel at its rest pose holding nothing ...
// `sim.cycle` at `0`, `sim.fraction` at `0`."
//
// WHERE THE TWO POSES ARE READ. They are separate fields, and
// `specs/instrumentation.md` keeps them apart: `editor.parts` carries the placed
// part's `rotation` and `length`, and `sim.poses` carries the live
// `{ part, rotation, length, cell }`. This check reads BOTH, because the rule is
// that the second begins as a copy of the first.
//
// THE CONFIGURATION. One `arm` at `(0, 0)` placed at rotation `4` and length
// `ARM_MAX_LEN` (`3`), and one `wheel` at `(-3, 0)` placed at rotation `2` — every
// figure deliberately away from the values a run that ignored the placement would
// land on, which are rotation `0` and `ARM_MIN_LEN` (`1`). Both tapes are empty,
// "which every part rests on" (`specs/instrumentation.md`), so nothing has moved
// either part between the run-start sequence and the reading. The field is emptied
// after the start, so the pose is the whole of what is under test.
//
// THE VERDICT. At the run's first frame `sim.poses` reports the arm at rotation
// `4`, length `3`, on its anchor cell, and the wheel at rotation `2`;
// `editor.parts` still reports the same placed figures; the run is on cycle `0`
// at fraction `0`; and `sim.grips` is empty, because a run starts every part
// "holding nothing".

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertLength,
  assertNear,
  assertNotNull,
} from "../assert";
import { ARM_MAX_LEN, ARM_MIN_LEN, FRACTION_TOLERANCE } from "../constants";
import { armPart, solution } from "../formats";
import { BARE, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partById,
  partIds,
  poseOf,
  type Harness,
} from "../harness";

/** Figures a run that ignored the placement could not land on by accident. */
const ARM_ROTATION = 4;
const ARM_LENGTH = ARM_MAX_LEN;
const WHEEL_ROTATION = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("begins the run with each part at the rotation and length it was placed at", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: solution([
      armPart("arm", ORIGIN.q, ORIGIN.r, ARM_ROTATION, ARM_LENGTH, []),
      armPart("wheel", WEST.q, WEST.r, WHEEL_ROTATION, 1, []),
    ]),
  });
  const ids = await partIds(h);
  const arm = ids[0] ?? -1;
  const wheel = ids[1] ?? -1;

  const snapshot = await h.snapshot();
  await h.advance(1);
  await captureStill(h, "start");

  const sim = snapshot.sim;
  assertNotNull(sim, "startRun left a live run to read the poses off");
  assertEqual(sim?.status, "running", "the run is live at its first frame");
  assertEqual(sim?.cycle, 0, "a run starts with sim.cycle at 0");
  assertNear(
    sim?.fraction ?? -1,
    0,
    FRACTION_TOLERANCE,
    "a run starts with sim.fraction at 0, so nothing has moved yet",
  );

  const armPose = poseOf(snapshot, arm);
  assertNotNull(armPose, "the run reports a live pose for the placed arm");
  assertEqual(
    armPose?.rotation,
    ARM_ROTATION,
    `the arm begins the run at its placed rotation ${ARM_ROTATION}, not at rotation 0`,
  );
  assertEqual(
    armPose?.length,
    ARM_LENGTH,
    `the arm begins the run at its placed length ${ARM_LENGTH}, not at ARM_MIN_LEN (${ARM_MIN_LEN})`,
  );
  assertEqual(
    `${armPose?.cell.q},${armPose?.cell.r}`,
    `${ORIGIN.q},${ORIGIN.r}`,
    "the arm's base cell is the anchor hex it was placed on",
  );

  const wheelPose = poseOf(snapshot, wheel);
  assertNotNull(wheelPose, "the run reports a live pose for the placed wheel");
  assertEqual(
    wheelPose?.rotation,
    WHEEL_ROTATION,
    `the wheel begins the run at its placed rotation ${WHEEL_ROTATION} too`,
  );

  assertEqual(
    partById(snapshot, arm)?.rotation,
    ARM_ROTATION,
    "the placed rotation is still what editor.parts reports: it is the rest pose",
  );
  assertEqual(
    partById(snapshot, arm)?.length,
    ARM_LENGTH,
    "the placed length is still what editor.parts reports: it is the rest length",
  );
  assertLength(
    sim?.grips ?? [],
    0,
    "a run starts every arm and wheel at its rest pose holding nothing",
  );
});
