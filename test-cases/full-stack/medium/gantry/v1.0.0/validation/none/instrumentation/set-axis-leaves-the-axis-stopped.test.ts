// instrumentation/set-axis-leaves-the-axis-stopped — `setAxis` leaves the axis
// stopped with no live command.
//
// `specs/instrumentation.md` § The run in progress: "`setAxis(axis, value)` — Sets an
// axis's value, leaving it stopped with no live command." The interesting case is the
// axis that was DRIVING: `specs/program.md` has a commanded axis accelerate, cruise
// and brake toward its target, so a build that only wrote the value would leave the
// controller pulling the posed axis straight back toward the target it was given and
// a scenario that posed a hoist length would watch it unwind.
//
// THE AXIS IS POSED MID-COMMAND, not from rest. The tape's first step commands the
// hoist, and the check waits for the tick that has issued that command and moved the
// axis under it, so all three readings afterwards say something: the value is the
// posed one rather than the one the controller had reached, the rate is back to zero
// rather than the rate it was carrying, and the command is gone rather than live.
//
// The command hoists the cable IN, toward `HOIST_MIN`, so the hook rises: the point
// is about the pose and the check must reach it without the run ending for a reason
// of its own.
//
// Nothing is advanced between the pose and the reading, so what is read is what
// `setAxis` left.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_MIN } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** The value posed onto the driving axis: neither its target nor where it was. */
const POSED = 3;

/** A command is issued on the run's first tick, so this is generous. */
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("stops a driving axis at the posed value with no command left on it", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_MIN, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);

  const driving = await runUntil(
    h,
    (s) => s.run.axes.hoist.command !== null && s.run.axes.hoist.rate !== 0,
    CAP,
    "the hoist to be driving under the command its step issued",
  );

  await h.debug.setAxis("hoist", POSED);
  const posed = await h.snapshot();
  await h.capture("state", "the hoist axis setAxis stopped");

  assertNotEqual(
    driving.run.axes.hoist.rate,
    0,
    "the rate the hoist was carrying when it was posed",
  );
  assertEqual(
    posed.run.axes.hoist.value,
    POSED,
    "the hoist's value after setAxis (specs/instrumentation.md)",
  );
  assertEqual(
    posed.run.axes.hoist.rate,
    0,
    "the hoist's rate after setAxis: it is left stopped",
  );
  assertNull(
    posed.run.axes.hoist.command,
    "the hoist's live command after setAxis: it is left with none",
  );
});
