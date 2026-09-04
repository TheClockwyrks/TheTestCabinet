// tape/controller-arrives-exactly — the tick an axis reaches its target on sets
// the axis exactly on the target and stops it.
//
// specs/program.md § Axis motion, step 3: "Arrive: if `s * (T - x) <= 0`, the
// advance reached or crossed the target; set `x = T`, `v = 0`, and the command is
// done."
//
// THE ARRIVING TICK OVERSHOOTS, which is what makes the rule visible. The
// controller brakes at a fixed acceleration in whole ticks, so the last tick of a
// move almost never lands on the target: it crosses it, and the specification has
// the axis SET to the target rather than left where the advance put it. A build
// that let the advance stand would report a value a fraction past the target,
// and one that kept the rate would report a moving axis with no command left to
// move it.
//
// THE MOVE IS THE SHORTEST ONE THAT STILL ARRIVES BY OVERSHOOTING. The hoist runs
// from `HOIST_START` (`2`) to `2.1` at the hoist's max rate: inside the hoist's
// range (`HOIST_MIN` `1` to `HOIST_MAX` `40`) so the step is not refused, and far
// enough that the controller drives up to `0.8` a second, brakes, and CROSSES the
// target rather than landing on it — eight driving ticks, five braking, and a
// thirteenth advance that ends at `2.10166...`, past `2.1`. That overshoot is what
// step 3 has to take away, so a build that let the advance stand fails here
// exactly as it would over a longer move. A longer move reads the same three-step
// rule the same way at three times the cost, and the sweep below drives one tick
// per crossing, so the length of the move is the whole cost of this point.
//
// The sweep runs until the command clears — one tick is driven first, because at
// the top of a run no step has been taken and the axis carries no command yet —
// and the reading is taken from the state that sweep answers with, which is the
// arriving tick's own.
//
// The yard is emptied so nothing hangs on the hook: what this decides is the
// controller's arrival, which reads the axis and nothing else.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, TICK_HZ } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** A tenth of a unit up from where every run starts the hoist. */
const TARGET = HOIST_START + 0.1;

/** Generous against the move's own length, which is thirteen ticks. */
const CAP = TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets an arriving axis exactly on its target, stopped, with its command done", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: TARGET, rate: HOIST_MAX_RATE }],
    },
  ]);
  await startRun(h);

  // One tick to issue the command, then a tick at a time until it is done.
  await runTicks(h, 1);
  const arrived = await runUntil(
    h,
    (s) => s.run.axes.hoist.command === null,
    CAP,
    "the hoist's command to be done",
  );

  await h.capture("state", "The hoist on the tick it reached its target");

  assertEqual(
    arrived.run.axes.hoist.value,
    TARGET,
    "the hoist's value on the tick it arrived, which the controller sets to " +
      "the target exactly rather than leaving where the advance put it " +
      "(specs/program.md)",
  );
  assertEqual(
    arrived.run.axes.hoist.rate,
    0,
    "the hoist's rate on the tick it arrived (specs/program.md)",
  );
  assertNull(
    arrived.run.axes.hoist.command,
    "the hoist's command on the tick it arrived, which is done " +
      "(specs/program.md)",
  );
});
