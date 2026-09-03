// tape/grip-is-unbounded — the grip axis has no range, so a tape may turn the
// hook as far as it likes.
//
// `specs/program.md` § The axes gives the `grip` row a range of "unbounded", and
// the tape rule it is measured against in the same file: "A step whose command
// targets a value outside its axis's range at that moment ends the run as
// `command-out-of-range`." An unbounded axis has no such value, so a target of
// `540` — a turn and a half — is issued like any other and the axis drives to it.
//
// FIVE HUNDRED AND FORTY DEGREES, not ninety, because the reading has to separate
// an unbounded axis from one a build wrapped or clamped. A build that folded the
// grip into `[0, 360)` reports `180` where the specification asks for `540`; one
// that clamped it at a full turn reports `360`; one that judged it out of range
// fails the run. Each of the three is a different value in the same reading.
//
// THE HOOK TURNS ALONE. The yard is emptied, so no load is attached and the grip
// "turns the bare hook, visibly and to no other effect" (`specs/rigging.md`):
// nothing about the swing, the tension or the solve can end the run while the
// scenario is waiting, and the verdict rests on the axis.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertEqual, assertNull } from "../assert";
import { GRIP_MAX_RATE, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A turn and a half: past a full turn, and not a wrap of anything smaller. */
const TARGET = 540;

/** The move the tape carries. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: TARGET, rate: GRIP_MAX_RATE }],
  },
];

/**
 * The cap: `540` degrees at `GRIP_MAX_RATE` is twelve seconds of run clock
 * before the ramps at either end, so twenty seconds is comfortable slack and
 * still bounds a build that never arrives.
 */
const CAP = 20 * TICK_HZ;

/** The controller sets the value to the target exactly on arrival. */
const TOL = 1e-9;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drives the grip to a target past a full turn", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const arrived = await runUntil(
    h,
    (s) =>
      s.run.phase !== "running" ||
      Math.abs(s.run.axes.grip.value - TARGET) <= TOL,
    CAP,
    `the grip to reach ${TARGET}, or the run to end trying`,
  );
  await h.capture("state", "The driven state this point decides");

  assertNull(
    arrived.run.cause,
    `the failure cause of a run whose grip was told to turn to ${TARGET}: ` +
      "the grip's range is unbounded (specs/program.md)",
  );
  assertClose(
    arrived.run.axes.grip.value,
    TARGET,
    TOL,
    "the grip's value where its command stopped (specs/program.md)",
  );
  assertEqual(
    arrived.run.axes.grip.rate,
    0,
    "the grip's rate once it arrived (specs/program.md)",
  );
});
