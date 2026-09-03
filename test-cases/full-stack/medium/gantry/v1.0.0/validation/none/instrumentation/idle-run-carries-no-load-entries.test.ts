// instrumentation/idle-run-carries-no-load-entries — the idle placeholder holds
// no loads, whatever is standing in the yard.
//
// specs/instrumentation.md § Snapshot shape: "`run.loads` carries one entry per
// load the run started with, in that order (`specs/state.md`); the idle
// placeholder carries no load entries." specs/state.md says the same from the
// state's side and names what puts the placeholder back: "It is what the run
// carries before the first run of a site, and what opening a site, aborting a
// run, and a `reset` put back."
//
// So the three ways to the placeholder are the three readings here, and the yard
// under every one of them is site 2's, which specs/sites.md authors with TWO
// crates — because the mistake this decides is a `run.loads` read off the yard
// instead of off the run. A build that reported the yard would answer two entries
// at each of the three, and the empty list is what separates the run's own record
// of a lift from the site's list of what is to be lifted.
//
// `site.loads` is read beside it every time, so a failure cannot be explained by
// a yard that quietly emptied itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, SITES } from "../constants";
import {
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Turnabout: two crates, and no obstacle to complicate the crane. */
const SITE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports no load entries on an opened site, an aborted run and a reset", async () => {
  const authored = SITES[SITE]!.loads.length;

  // Opening a site.
  await openSite(h, SITE);
  const opened = await h.snapshot();
  assertLength(opened.site.loads, authored, "the loads site 2 is authored with");
  assertEqual(opened.run.phase, "idle", "the run a site opening puts back");
  assertLength(
    opened.run.loads,
    0,
    "the load entries the idle placeholder carries on an opened site " +
      "(specs/instrumentation.md)",
  );

  // Aborting a run.
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [
        { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
      ],
    },
  ]);
  await startRun(h);
  await runTicks(h, 10);
  await h.debug.abortRun();

  const aborted = await h.snapshot();
  assertEqual(aborted.run.phase, "idle", "the run an abort puts back");
  assertLength(
    aborted.run.loads,
    0,
    "the load entries the idle placeholder carries after an abort " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    aborted.site.loads,
    authored,
    "the loads still standing in the yard after the abort",
  );

  // And a reset.
  await h.debug.reset();
  const reset = await h.snapshot();
  assertEqual(reset.run.phase, "idle", "the run a reset puts back");
  assertLength(
    reset.run.loads,
    0,
    "the load entries the idle placeholder carries after a reset " +
      "(specs/instrumentation.md)",
  );
  assertLength(
    reset.site.loads,
    SITES[0]!.loads.length,
    "the loads a reset puts back in site 1's yard",
  );

  await h.advance(1);
  await h.capture(
    "idle-run-loads",
    "The idle run standing over a yard that holds loads",
  );
});
