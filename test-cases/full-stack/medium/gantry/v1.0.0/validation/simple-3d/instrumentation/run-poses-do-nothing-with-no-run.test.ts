// instrumentation/run-poses-do-nothing-with-no-run — a run pose with no run in
// progress reaches the idle run, and one naming a load index fails loudly.
//
// `specs/instrumentation.md` § The run in progress: "The first six pose the run
// the snapshot reports, which is the run in progress where there is one and the
// idle placeholder where there is not; whether a run is live is not a condition
// on them." The rule above the tables is what puts them there: "No operation asks
// which screen is showing, whether a run is in progress, or which tool is
// selected. Those are how a player reaches a control and are not an operation's
// conditions."
//
// THE FOUR UNINDEXED POSES REACH THE PLACEHOLDER. `setAxis`, `setAxisRate`,
// `setBob` and `setBobVelocity` name a field the idle run carries — the axes are
// at the run-start posture, the bob at the origin (`specs/state.md`) — so there is
// a defined state to reach and each reaches it. Each asks for something the
// placeholder does not already hold, so a call that was swallowed is visible.
//
// THE TWO THAT NAME A LOAD INDEX FAIL LOUDLY, and that is the same rule read from
// the other end: "an index no site, load, or tape step carries" is an invalid
// argument that "fails loudly rather than guessing what was meant", and the idle
// placeholder carries "an empty load, force, and broken list". So `setLoadPose(0,
// …)` and `setLoadPhase(0, …)` name nothing and must raise rather than pass
// quietly. One load stands in the YARD, so a build that read the index against
// the site's loads instead would take the call and fail here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("poses the idle run, and fails loudly on a load index it carries no entry for", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 8, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 0 },
  );

  const idle = await h.snapshot();
  assertEqual(
    idle.run.phase,
    "idle",
    "the run before any of these, which is the idle placeholder " +
      "(specs/state.md)",
  );

  await h.debug.setAxis("hoist", 9);
  await h.debug.setAxisRate("slew", 12);
  await h.debug.setBob(3, 5, -2);
  await h.debug.setBobVelocity(1, -2, 3);
  await h.debug.reconcile();
  const posed = await h.snapshot();

  const raised: boolean[] = [];
  for (const call of [
    () => h.debug.setLoadPose(0, 3, 3, 3, 45),
    () => h.debug.setLoadPhase(0, "attached"),
  ] as const) {
    let threw = false;
    try {
      await call();
    } catch {
      threw = true;
    }
    raised.push(threw);
  }
  const after = await h.snapshot();

  await h.advance(1);
  await h.capture("state", "the idle run four run poses reached");

  assertEqual(
    posed.run.axes.hoist.value,
    9,
    "the hoist setAxis posed onto the idle run: the placeholder carries the " +
      "field, so there is a defined state to reach (specs/instrumentation.md)",
  );
  assertEqual(
    posed.run.axes.slew.rate,
    12,
    "the slew rate setAxisRate posed onto the idle run " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(posed.run.bob.pos),
    JSON.stringify({ x: 3, y: 5, z: -2 }),
    "the bob setBob posed onto the idle run (specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(posed.run.bob.vel),
    JSON.stringify({ x: 1, y: -2, z: 3 }),
    "the bob velocity setBobVelocity posed onto the idle run " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    raised[0],
    true,
    "setLoadPose(0, …) to fail loudly: the idle run carries an empty load " +
      "list, so index 0 names nothing (specs/instrumentation.md)",
  );
  assertEqual(
    raised[1],
    true,
    "setLoadPhase(0, …) to fail loudly, for the same reason " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    after.run.loads.length,
    0,
    "the run's load entries after the two refused calls: a call that fails " +
      "reaches nothing, and the yard's load is the SITE's " +
      "(specs/instrumentation.md)",
  );
});
