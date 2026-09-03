// rigging/attach-squares-the-grip — an `attach` sets the grip to the load's yaw.
//
// specs/rigging.md § Attaching: "With a candidate, the load becomes `attached`:
// the grip's axis value is set to the load's current yaw, so the hook seizes the
// load squarely and the load's yaw is thereafter the grip's value". The grip is
// the hook's own yaw (specs/program.md), so a lift that left the grip where it
// stood would spin the load to the grip's angle the moment it left the ground.
//
// THE LOAD STANDS SKEWED TO THE HOOK, WHICH IS THE ONLY WAY THE POINT SHOWS. Every
// run starts with `grip` at `0` (specs/program.md § The axes), so a load lying at
// yaw `0` would leave the grip at `0` whether the rule was honoured or ignored.
// This load waits at yaw `LOAD_YAW` (`30`), and the reading is taken on the
// `attach`'s own tick, before the tape's next step can touch the axis.
//
// THE HOOK POINT IS POSED where the run starts it — the pivot minus
// `(0, HOIST_START, 0)`, which the cable holds at its current length — and the
// load waits `0.3` from it, well inside `ATTACH_RADIUS` (`0.8`), so the lift is
// certain and the reading is about the grip alone.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` is not the run's own first tick. It is a
// `slew` move rather than a `grip` one for the obvious reason.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
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

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The yaw the load lies at, skewed to the grip's run-start `0`. */
const LOAD_YAW = 30;

/** Where the load waits: inside ATTACH_RADIUS, and lying skewed. */
const LOAD_AT = { x: HOOK.x + 0.3, y: HOOK.y, z: HOOK.z, yaw: LOAD_YAW };

/** An angle set by assignment; the tolerance is arithmetic noise, not slack. */
const TOLERANCE = 1e-9;

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that keeps the run running past the `attach`, taken a tick later. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sets the grip to the load's yaw on the tick the attach executes", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, LOAD_AT, LOAD_AT);
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  const started = await startRun(h);
  assertEqual(
    started.run.axes.grip.value,
    0,
    "the grip a run starts at (specs/program.md § The axes)",
  );

  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);

  const taken = await runTicks(h, 1);
  await h.capture("state", `a load seized square at yaw ${LOAD_YAW}`);

  assertEqual(
    taken.run.attached,
    0,
    "the load `attach` took: the one waiting load, 0.3 from the hook point",
  );
  assertNear(
    taken.run.axes.grip.value,
    LOAD_YAW,
    TOLERANCE,
    `the grip's value on the tick the \`attach\` executed, against the load's ` +
      `own yaw of ${LOAD_YAW}: "the grip's axis value is set to the load's ` +
      'current yaw, so the hook seizes the load squarely" ' +
      "(specs/rigging.md § Attaching)",
  );
  assertNear(
    taken.run.loads[0]?.yaw as number,
    LOAD_YAW,
    TOLERANCE,
    "the load's own yaw across the lift: squared onto the grip rather than " +
      "spun to it (specs/rigging.md § Attaching)",
  );
});
