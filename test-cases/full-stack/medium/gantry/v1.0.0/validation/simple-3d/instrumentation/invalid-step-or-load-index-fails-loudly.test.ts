// instrumentation/invalid-step-or-load-index-fails-loudly — an index no tape
// step and no load carries is a bad argument.
//
// specs/instrumentation.md § The operations: "An argument outside the domain its
// operation states is invalid, and the call fails loudly rather than guessing
// what was meant. So is an index no site, load, or tape step carries."
//
// Four operations index a step or a load, and each is called here one past what
// the world holds: `removeStep` and `addCommand` against a three-step tape,
// `setLoadTarget` against a one-load yard, and `setLoadPhase` against the loads
// the run carries — one, since "the loads a run carries are the ones standing
// when it starts".
//
// EACH CALL IS MADE WHERE ITS OPERATION APPLIES. The tape poses are the program
// screen's, the site poses the build screen's with no run in progress, and
// `setLoadPhase` is a run-in-progress pose, so the run is real and started the
// way the `run` action starts it. Otherwise a call that did nothing would have
// two explanations and this check would decide neither.
//
// The tape and the yard are read back after every call: an index the surface
// guessed at would have removed the last step or moved the only load.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertLength, fail } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Three move steps, one axis each: a tape whose indices are 0, 1 and 2. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE },
    ],
  },
  {
    kind: "move",
    commands: [{ axis: "trolley", target: 1, rate: TROLLEY_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: 10, rate: SLEW_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fails loudly on a step or load index nothing carries, and edits nothing", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 6, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 0 },
  );
  await poseTape(h, TAPE);

  const posed = await h.snapshot();
  assertLength(posed.program, TAPE.length, "the steps the scenario appended");
  assertLength(posed.site.loads, 1, "the load the scenario stood in the yard");

  // The tape poses, on the program screen the tape editor lives on.
  await h.debug.setScreen("program");
  await refuses("removeStep(3)", () => h.debug.removeStep(TAPE.length));
  await refuses('addCommand(7, "grip", ...)', () =>
    h.debug.addCommand(7, "grip", 90, 45),
  );
  await h.debug.setScreen("build");

  // The site pose, on the build screen, with no run in progress.
  await refuses("setLoadTarget(2, ...)", () =>
    h.debug.setLoadTarget(2, 0, 2, 0, 0),
  );

  // And the run-in-progress pose, inside a run the `run` action started.
  await startRun(h);
  await refuses('setLoadPhase(4, "attached")', () =>
    h.debug.setLoadPhase(4, "attached"),
  );

  await h.capture(
    "step-and-load-indices-intact",
    "The tape and the load the four refused calls left as they were",
  );
});

/**
 * `call` fails loudly, and the tape and the yard are the same reading after it.
 *
 * Both are read every time rather than once at the end, so a failure names the
 * call that wrote something instead of reporting that one of four did.
 */
async function refuses(what: string, call: () => Promise<void>): Promise<void> {
  const before = await h.snapshot();
  let threw = false;
  try {
    await call();
  } catch {
    threw = true;
  }
  if (!threw) {
    fail(
      `${what} to fail loudly, no step and no load carrying that index ` +
        "(specs/instrumentation.md)",
      "the call returned instead",
    );
  }
  const after = await h.snapshot();
  assertDeepEqual(after.program, before.program, `the tape across ${what}`);
  assertDeepEqual(
    after.site.loads,
    before.site.loads,
    `the yard's loads across ${what}`,
  );
  assertDeepEqual(
    after.run.loads,
    before.run.loads,
    `the run's load entries across ${what}`,
  );
}
