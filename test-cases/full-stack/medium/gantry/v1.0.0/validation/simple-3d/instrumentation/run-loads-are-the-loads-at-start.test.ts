// instrumentation/run-loads-are-the-loads-at-start — a run's load list is the loads
// standing when it started.
//
// `specs/instrumentation.md` § The site: "The loads a run carries are the ones
// standing when it starts, index-aligned with them", and `specs/state.md` says what
// each entry holds at that moment: "one entry per load standing in the yard, in the
// site's order, each `waiting` at the pose it stands at". That is the whole reason a
// scenario may pose its own yard: a run that carried the site's AUTHORED loads
// instead would ignore every `clearLoads` and `addLoad` a check made before starting
// it, and every choreography scenario in the suite would be run against a yard it
// did not ask for.
//
// SITE 5, `High Shelf`, IS THE SITE THIS IS DECIDED ON, because its authored yard
// carries TWO loads (`specs/sites.md`). The yard is emptied and one load is put
// back, so a run that carries the authored set reads two entries here and a run
// that carries the standing set reads one — a reading site 1, with its single
// authored load, could not tell apart.
//
// The crane is the harness's minimal one and the tape is one short hoist: neither is
// what this decides, and both are only here because a run has to start.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** `High Shelf`, counted from 0: the site whose yard is authored with two loads. */
const SITE_INDEX = 4;

/** Where the one load this check leaves standing waits. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 } as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries one entry per load standing when the run started", async () => {
  await openSite(h, SITE_INDEX);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, { x: -6, y: 2, z: 0, yaw: 0 });
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
    },
  ]);

  const started = await startRun(h);
  await h.capture("state", "the run's loads at the tick it started on");

  assertLength(
    started.site.loads,
    1,
    "the loads standing in the yard when the run started",
  );
  assertLength(
    started.run.loads,
    1,
    "the entries the run carries: one per load standing at the start, not " +
      `per load site ${SITE_INDEX + 1} is authored with ` +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    started.run.loads[0]?.phase,
    "waiting",
    "the phase the one entry starts in (specs/state.md)",
  );
  assertDeepEqual(
    started.run.loads[0]?.pos,
    { x: FROM.x, y: FROM.y, z: FROM.z },
    "where that entry stands: the lift point the load was posed at",
  );
  assertEqual(
    started.run.loads[0]?.yaw,
    FROM.yaw,
    "the yaw that entry stands at",
  );
});
