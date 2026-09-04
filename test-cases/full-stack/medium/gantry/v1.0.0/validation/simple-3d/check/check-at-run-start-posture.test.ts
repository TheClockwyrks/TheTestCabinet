// check/check-at-run-start-posture — the check's solve is the solve a run's first
// tick makes when its first step commands no motion.
//
// specs/structure.md § The static check: the two solves "run at the run-start
// posture `specs/program.md` fixes, `slew` `0`, `trolley` `0`, `hoist`
// `HOIST_START`, and `grip` `0`, with the bare hook hanging at rest and nothing
// moving". specs/program.md § The axes gives that same posture as the one every
// run starts from, and § Axis motion says of a command targeting its axis's
// current value: "the axis neither brakes nor accelerates, it does not move, and
// step 3 finds it arrived, so the command is done on the tick it is issued", with
// the acceleration a tick that arrives reports being `0`.
//
// So a run whose first step commands `slew` to `0` — the value it already stands
// at — stands, on its first tick, at exactly the posture the check solves: every
// axis at its start value, every axis acceleration `0`, and the bare hook hanging
// at rest, whose cable force on that first tick is its weight straight down
// (specs/rigging.md: "On a run's first tick the acceleration is zero", so
// `T = m * (a - g)` is `HOOK_MASS * GRAVITY` upward on the bob and its weight
// down on the structure). The two solves therefore have the same geometry, the
// same lumped masses and the same applied forces, and must agree member for
// member.
//
// The minimal crane is the crane, because the requirement is about the posture
// the solve is taken at rather than about any particular structure.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear } from "../assert";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Force units. The two solves are one computation over one posture. */
const FORCE_TOL = 1e-6;

/** Utilization is a force over a fixed capacity, so it carries the same span. */
const UTIL_TOL = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solves the run-start posture a first tick that commands no motion stands at", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);

  // One move step, commanding `slew` to the value it already holds: the tick
  // issues it, nothing moves, and it is done on the tick it is issued.
  await poseTape(h, [
    { kind: "move", commands: [{ axis: "slew", target: 0, rate: 1 }] },
  ]);

  const checked = await h.check();

  await startRun(h);
  const first = await runTicks(h, 1);
  assertEqual(first.run.tick, 1, "the run's first tick");

  assertLength(
    first.run.forces,
    checked.members.length,
    "the members the run's first solve reports, against the members the check " +
      "reports (specs/structure.md)",
  );
  for (const [index, member] of checked.members.entries()) {
    const solved = first.run.forces[index];
    assertEqual(
      solved?.id,
      member.id,
      `the id at position ${index} of the first tick's forces, in member-id ` +
        "order as the check's are",
    );
    assertNear(
      solved?.force ?? Number.NaN,
      member.force,
      FORCE_TOL,
      `member ${member.id}'s force on the run's first tick, against the ` +
        "check's at the same posture",
    );
    assertNear(
      solved?.utilization ?? Number.NaN,
      member.utilization,
      UTIL_TOL,
      `member ${member.id}'s utilization on the run's first tick, against ` +
        "the check's at the same posture",
    );
  }

  await h.capture(
    "run-start-solve",
    "the run's first tick at the posture the check solves",
  );
});
