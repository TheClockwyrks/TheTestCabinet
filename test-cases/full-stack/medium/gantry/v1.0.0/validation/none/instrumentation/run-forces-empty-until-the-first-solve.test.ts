// instrumentation/run-forces-empty-until-the-first-solve — forces are the latest
// solve's, so there are none before the first.
//
// specs/instrumentation.md § Snapshot shape: "`run.forces` is the latest solve's,
// in member-id order, and covers the members still intact. It is empty until a
// run's first solve." specs/state.md gives the same fact twice: the run carries
// "the latest solve's force and utilization per intact member, in member-id
// order, and none until a run's first solve", and the idle placeholder carries
// "an empty load, force, and broken list". What a run's start leaves says it a
// third time: "The forces and the broken list — empty: no solve has run yet."
//
// Two moments are read, and they are the two the specification names: the idle
// placeholder, before any run of the site; and the instant a run has started,
// where "nothing has ticked at the call, so `run.tick` reads `0` immediately
// after it". A build whose `run.forces` is the static check's, or the previous
// run's, or a solve run eagerly at the start, reports members at one or both.
//
// The crane is standing and ready — the static check solves it and reports its
// members — so the emptiness is the run's own and not a structure with nothing to
// solve.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
} from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no forces on the idle placeholder or at the instant a run starts", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);

  // The structure solves, so a solve has members to report and the emptiness
  // below is about when it ran rather than about what it had to work with.
  const check = await h.check();
  assertTrue(check.stable, "the crane the run is started on stands");
  assertGreaterThan(
    check.members.length,
    0,
    "the members a solve of this crane reports (specs/structure.md)",
  );

  const idle = await h.snapshot();
  assertEqual(idle.run.phase, "idle", "the run before the site's first run");
  assertLength(
    idle.run.forces,
    0,
    "the forces the idle placeholder carries (specs/state.md)",
  );

  const started = await startRun(h);
  await h.capture(
    "forces-empty",
    "The run at tick 0, carrying no solve of its own yet",
  );

  assertEqual(
    started.run.tick,
    0,
    "the tick a run reads immediately after it starts",
  );
  assertLength(
    started.run.forces,
    0,
    "the forces a run carries before its first tick has solved " +
      "(specs/instrumentation.md)",
  );
});
