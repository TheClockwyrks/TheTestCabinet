// simulation/break-does-not-touch-the-structure — a run's breakages leave the
// authored structure alone.
//
// specs/state.md § The idle run and a finished one, on what a finished run holds:
// the broken list belongs to the run that broke them and the structure itself is
// untouched. specs/program.md § Starting and ending a run says the same from the
// other side — "Either way the structure, the tape, and the loads' starting poses
// are untouched: every run begins from the same authored state, and running is
// always repeatable" — and specs/structure.md § The static check reports "each
// intact member's force and utilization", which for the crane on the build screen
// is every member the player placed.
//
// THE RUN IS DRIVEN UNTIL IT BREAKS MEMBERS, and then the build screen is read.
// The harness's minimal crane carries a `200`-mass load at the far end of its
// track, which takes several members past utilization `1` on the first tick; the
// run ends there, and what this check reads afterwards is the structure and the
// check that describe the crane on screen. A build that removed the broken
// members from the structure rather than from the run would lose them here.
//
// The verdict is about the whole member list rather than about any one member, so
// it names every id the pose placed and every id the check reports back.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThanOrEqual, assertLength, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** First Lift: the minimal crane stands on it inside budget. */
const SITE = 0;

/** Heavy enough to take several members past utilization 1 at once. */
const LOAD_MASS = 200;

/** The far end of the minimal crane's one-rail track, in units from its origin. */
const TIP = 4;

/** Where the load waits: on the hook, which is where it is hung from. */
const ON_THE_HOOK = { x: 0, y: 2, z: 0, yaw: 0 };

/** A tape that keeps the run ticking and touches nothing the solve reads. */
const TURN_THE_GRIP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 3600, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every authored member standing after a run has broken some of them", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, ON_THE_HOOK, ON_THE_HOOK);
  await poseTape(h, TURN_THE_GRIP);

  await startRun(h);
  await h.debug.setLoadPhase(0, "attached");
  await h.debug.setAxis("trolley", TIP);
  const { run } = await runTicks(h, 1);

  assertGreaterThanOrEqual(
    run.broken.length,
    2,
    "the members the run broke, which is what this check is about " +
      "(specs/statics.md § Utilization and breakage)",
  );

  await h.debug.setScreen("build");
  const { structure } = await h.snapshot();
  const result = await h.check();
  await h.advance(1);
  await h.capture("state", "The driven state this point decides");

  assertLength(
    structure.members,
    MINIMAL_CRANE.members.length,
    "the members the structure still carries once a run has broken some of " +
      "them: the broken list belongs to the run, not to the crane " +
      "(specs/state.md § The idle run and a finished one)",
  );
  assertTrue(
    run.broken.every((id) =>
      structure.members.some((member) => member.id === id),
    ),
    "every member the run broke to still stand in the structure the build " +
      `screen shows (it broke ${JSON.stringify(run.broken)})`,
  );
  assertLength(
    result.members,
    MINIMAL_CRANE.members.length,
    "the members the build screen's check reports, which is every intact " +
      "member of the crane on screen (specs/structure.md § The static check)",
  );
});
