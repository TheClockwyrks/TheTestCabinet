// audio/placed-cue — the placed cue sounds on the tick a load is set down.
//
// specs/ui.md § Audio: "`placed` | a load is set down on its pad". A load is set
// down by the `release` action, and only when all three of the set-down tests
// hold: specs/rigging.md, "If all three hold, the load is `placed`: it leaves the
// hook, sits at exactly its target pose for the rest of the run, and the `placed`
// cue plays."
//
// THE RELEASE IS A REAL ONE, INSIDE EVERY TOLERANCE BY A WIDE MARGIN, and nothing
// about it is posed. The yard holds one crate whose starting pose AND whose pad
// are the point the bare hook comes to rest at: with the minimal crane the pivot
// is the track origin `(0, 4, 0)` and the tape's first step draws the cable in to
// `HOIST_MIN`, so the bob hangs at rest at `(0, 3, 0)` — the load's lift point and
// its target both. The `attach` step then takes it at a distance of zero, well
// inside `ATTACH_RADIUS`, and the `release` step judges it at a position error of
// zero, a yaw error of zero (the grip took the load's own yaw at the attach) and
// a speed of zero, all far inside `PLACE_POS_TOL`, `PLACE_YAW_TOL` and
// `PLACE_VEL_TOL`. So the tick under test is a set-down that every conforming
// build agrees is one.
//
// The cue is read off the release tick alone: the queue is drained on the tick
// before it, and the tick after it is the one that ends the run
// (specs/program.md), which sounds `complete` and is no part of this.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  addOneLoad,
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

/** Where the bare hook comes to rest once the cable is drawn in to HOIST_MIN. */
const HOOK = { x: 0, y: HOIST_MIN + 2, z: 0, yaw: 0 } as const;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }] },
  { kind: "action", action: "attach" },
  { kind: "action", action: "release" },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the placed cue on the tick a load is set down on its pad", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  const held = await runUntil(
    h,
    (s) => s.run.attached !== null || s.run.phase !== "running",
    400,
    "the attach step to take the load",
  );
  assertEqual(held.run.attached, 0, "the load the attach step took");
  await h.cues();

  const released = await runTicks(h, 1);
  const played = await h.cues();

  assertEqual(
    released.run.loads[0]?.phase,
    "placed",
    "the load the release set down (specs/rigging.md)",
  );
  assertContains(
    played,
    "placed",
    "the cue a load being set down on its pad plays (specs/ui.md)",
  );

  await h.capture("pad", "The load set down on its pad");
});
