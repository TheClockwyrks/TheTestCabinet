// instrumentation/set-axis-rate-leaves-the-value-and-command — `setAxisRate` leaves
// the axis's value and its command alone.
//
// `specs/instrumentation.md` § The run in progress: "`setAxisRate(axis, rate)` — Sets
// an axis's signed rate, leaving its value and its command as they are", and, below
// the table, "Posing a rate onto an axis that is under a command sets what that axis
// is doing as the controller next reads it." So the pose is one field wide: the axis
// carries on toward the same target, from where it had got to.
//
// THE AXIS IS POSED MID-COMMAND, which is the only arrangement in which the sentence
// can be read at all — an axis with no live command has nothing for the pose to
// leave alone. The tape's first step commands the slew to sixty degrees, and the
// check waits for the tick that has issued it and moved the axis under it.
//
// THE RATE POSED IS NEGATIVE, away from the target the axis is driving toward, so a
// build that treated `setAxisRate` as a small `setAxis`-like reset — clearing the
// command, or snapping the value — is caught by the two readings that must NOT have
// moved.
//
// Nothing is advanced between the two readings, so the value and the command are
// compared across the pose alone rather than across a tick of the controller.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNotNull } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
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

/** The signed rate posed onto the axis: negative, and not the commanded rate. */
const POSED = -10;

/** A command is issued on the run's first tick, so this is generous. */
const CAP = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets a commanded axis's rate and leaves its value and command as they were", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "slew", target: 60, rate: SLEW_MAX_RATE }],
    },
  ]);
  await startRun(h);

  const driving = await runUntil(
    h,
    (s) => s.run.axes.slew.command !== null && s.run.axes.slew.rate !== 0,
    CAP,
    "the slew to be driving under the command its step issued",
  );
  const before = driving.run.axes.slew;

  await h.debug.setAxisRate("slew", POSED);
  const after = (await h.snapshot()).run.axes.slew;
  await h.capture("state", "the slew axis carrying the rate that was posed");

  assertNotNull(
    before.command,
    "the command the slew was driving under when it was posed",
  );
  assertEqual(
    after.value,
    before.value,
    "the slew's value across setAxisRate: it is left as it was " +
      "(specs/instrumentation.md)",
  );
  assertEqual(
    JSON.stringify(after.command),
    JSON.stringify(before.command),
    "the slew's live command across setAxisRate: it is left as it was, so the " +
      "axis keeps driving to the same target",
  );
  assertEqual(after.rate, POSED, "the signed rate setAxisRate set");
});
