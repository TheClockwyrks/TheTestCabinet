// instrumentation/run-poses-do-nothing-with-no-run — a run pose with no run in
// progress does nothing.
//
// `specs/instrumentation.md` § The run in progress lists seven operations and then
// says which of them need a run: "The first six pose the run while one is in
// progress." So `setAxis`, `setAxisRate`, `setBob`, `setBobVelocity`, `setLoadPose`
// and `setLoadPhase` change nothing against an idle run, exactly as the general rule
// requires — "Each pose applies on the screens its section names and does nothing on
// any other".
//
// THE IDLE PLACEHOLDER IS THE WHOLE READING. `specs/state.md` fixes what it is —
// "phase `idle`, no cause, a zero tick, step index, and speed index, no live step,
// the four axes at the run-start posture ... a zero pivot, a bob at the origin with
// zero velocity, no attachment, and an empty load, force, and broken list" — so the
// run is read whole after each of the six, and any field one of them wrote shows up.
// A build that wrote an axis value, or a bob position, onto the placeholder would
// hand the next run a posture it was not started with.
//
// EACH POSE ASKS FOR SOMETHING THE PLACEHOLDER DOES NOT ALREADY HOLD, so a call that
// landed would be visible: an axis value away from the run-start posture, a rate away
// from zero, a bob away from the origin.
//
// THE TWO POSES THAT NAME A LOAD INDEX MAY REFUSE LOUDLY INSTEAD, and that is not
// this point's business. The same file makes "an index no site, load, or tape step
// carries" an invalid argument that "fails loudly rather than guessing what was
// meant", and with no run in progress the run carries no load entries at all, so a
// build is free to read index `0` as outside the domain of a run pose. Either way the
// requirement is the same and is what is asserted: the idle run does not move. So the
// two are driven through a refusal that is allowed to raise, and the reading after
// them is taken all the same. One load stands in the yard, so a build that reads the
// index against the SITE's loads instead is on its silent path.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  addOneLoad,
  createHarness,
  emptyYard,
  openSite,
  type Harness,
} from "../harness";

/** One pose: what to call it, and whether naming a load index may refuse loudly. */
interface Pose {
  readonly name: string;
  readonly indexed: boolean;
  readonly run: () => Promise<void>;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves the idle run untouched by every pose that needs a run in progress", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 8, y: 2, z: 0, yaw: 0 },
    { x: -6, y: 2, z: 0, yaw: 0 },
  );

  const idle = JSON.stringify((await h.snapshot()).run);

  const poses: readonly Pose[] = [
    { name: "setAxis", indexed: false, run: () => h.debug.setAxis("hoist", 9) },
    {
      name: "setAxisRate",
      indexed: false,
      run: () => h.debug.setAxisRate("slew", 12),
    },
    { name: "setBob", indexed: false, run: () => h.debug.setBob(3, 5, -2) },
    {
      name: "setBobVelocity",
      indexed: false,
      run: () => h.debug.setBobVelocity(1, -2, 3),
    },
    {
      name: "setLoadPose",
      indexed: true,
      run: () => h.debug.setLoadPose(0, 3, 3, 3, 45),
    },
    {
      name: "setLoadPhase",
      indexed: true,
      run: () => h.debug.setLoadPhase(0, "attached"),
    },
  ];

  for (const pose of poses) {
    if (pose.indexed) {
      // An index the idle run carries no entry for may be refused loudly; what it
      // may not do is move the run.
      await pose.run().catch(() => undefined);
    } else {
      await pose.run();
    }
    assertEqual(
      JSON.stringify((await h.snapshot()).run),
      idle,
      `the idle run across a ${pose.name} made with no run in progress ` +
        "(specs/instrumentation.md)",
    );
  }

  await h.capture("state", "the idle run six run poses could not touch");
});
