// run — a failed run stays on the run screen.
//
// `specs/ui.md` § Run: "A cleared run moves to `results`. A failed run stays
// here, the scene as it stood, with the failure copy below shown plainly."
// `specs/program.md` says the same from the other side: "A failed run stays on
// the run screen with its cause read out and the scene as it stood, so the
// player reads what went wrong before going back to edit."
//
// This check decides that one requirement: after a run fails, the run screen is
// still the screen showing, and it stays showing. The failure copy itself, and
// the scene standing as it stood, are their own points.
//
// THE FAILURE IS THE CHEAPEST AND MOST ISOLATED ONE THE SPECIFICATION OFFERS. The
// tape's only step commands the hoist to a value past `HOIST_MAX`, and
// `specs/program.md` fixes what that does: "A step whose command targets a value
// outside its axis's range at that moment ends the run as
// `command-out-of-range`." It lands on the tick the step is taken, so the yard is
// empty of loads and obstacles, nothing collides, nothing breaks, and no rigging
// rule is involved in reaching the verdict this check is about.
//
// SIXTY FURTHER TICKS ARE DRIVEN AFTERWARDS, a second of run clock, because
// "stays" is the requirement: a build that showed the run screen on the failing
// tick and then moved on a frame later would satisfy a reading taken at the
// verdict alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A hoist target past `HOIST_MAX`, so the first tick ends the run. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_MAX + 60, rate: HOIST_MAX_RATE },
    ],
  },
];

/** Ticks the run is given to reach its verdict. */
const END_CAP = 120;

/** Ticks driven after the verdict: a second of run clock. */
const HELD_TICKS = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the run screen after a run fails", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the out-of-range command to end the run",
  );
  assertEqual(
    ended.run.phase,
    "failed",
    "the phase a command outside its axis's range leaves the run in " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.screen,
    "run",
    "the screen a failed run is on at the tick it failed (specs/ui.md)",
  );

  const held = await runTicks(h, HELD_TICKS);
  assertEqual(
    held.run.phase,
    "failed",
    `the phase the run holds ${HELD_TICKS} ticks later (specs/state.md)`,
  );
  assertEqual(
    held.screen,
    "run",
    `the screen showing ${HELD_TICKS} ticks after the failure: a failed run ` +
      "stays on the run screen (specs/ui.md)",
  );

  await h.capture("failed-run", "The run screen held after a failure");
});
