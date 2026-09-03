// tape/controller-accelerates — a commanded axis accelerates at its axis's fixed
// acceleration.
//
// specs/program.md § Axis motion: per tick, "otherwise drive, `v = v + s * a *
// dt` clamped to `[-r, +r]`", with `dt = 1 / TICK_HZ` and `s` the sign of the
// distance to go at the top of the tick. On the first tick of a move the axis is
// at rest, so `v` goes from `0` to `s * a * dt` exactly: for the hoist that is
// `HOIST_ACCEL / TICK_HZ`, `6 / 60`, `0.1` units a second.
//
// THE FIRST TICK IS THE ONE READING THAT ISOLATES THE DRIVE TERM. The clamp does
// not bind, because the commanded rate is the hoist's max (`4`) and the tick's
// drive reaches a fortieth of it. The brake test does not fire, because the
// distance to go (`10`) is far past `v * v / (2 * a)` (`0.00083`). And nothing
// else has run: this is the tick the command was issued on, so the rate the
// snapshot reports is one tick's drive and nothing accumulated.
//
// The target is `HOIST_START + 10`, inside the hoist's range (`HOIST_MIN` `1` to
// `HOIST_MAX` `40`) so the step is not refused when it starts, and far enough
// that the axis is nowhere near braking. The yard is emptied so no load is on the
// hook: what this decides is the controller, and a load would only change the
// forces the axis drives against, which the controller does not read.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import {
  HOIST_ACCEL,
  HOIST_MAX_RATE,
  HOIST_START,
  TICK_HZ,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
} from "../harness";

/** Far enough that the tick under test drives rather than brakes. */
const TARGET = HOIST_START + 10;

/** `s * a * dt` on the first tick: the whole of the drive term. */
const FIRST_TICK_RATE = HOIST_ACCEL / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drives a commanded axis to a * dt on the tick its command is issued", async () => {
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

  const first = await runTicks(h, 1);

  await h.capture("state", "The hoist one tick into its first move");

  assertNear(
    first.run.axes.hoist.rate,
    FIRST_TICK_RATE,
    1e-9,
    "the hoist's rate after one tick of a move issued at rest: HOIST_ACCEL " +
      `(${HOIST_ACCEL}) over TICK_HZ (${TICK_HZ}) (specs/program.md)`,
  );
});
