// rigging/attach-nearest-candidate — `attach` takes the NEAREST waiting load, not
// the first one it comes across.
//
// specs/rigging.md § Attaching: "The candidate is the `waiting` load whose lift
// point is nearest the hook point, ties going to the one the site lists first, if
// that distance is at most `ATTACH_RADIUS` (`0.8`)."
//
// THE NEARER LOAD IS THE ONE THE SITE LISTS SECOND, WHICH IS THE POINT. Two
// waiting loads stand in reach: `site.loads[0]` at `0.6` from the hook point and
// `site.loads[1]` at `0.3`. Both are inside `ATTACH_RADIUS`, so a build that took
// the first candidate it found, or the first in list order, would take load `0`
// and be indistinguishable from a correct one on any yard where the nearest load
// happens to be listed first. Here the two answers differ.
//
// THE HOOK POINT IS POSED, so the two distances are the ones written here rather
// than ones that depend on where a tick left the bob. `setBob` "puts the bob where
// it is asked for", and the position asked for is where the run starts it — the
// pivot minus `(0, HOIST_START, 0)` — so the cable holds it and nothing moves.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` is not the run's own first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  ATTACH_RADIUS,
  GRIP_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
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
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The load the site lists FIRST, the further of the two. */
const FAR = { x: HOOK.x + 0.6, y: HOOK.y, z: HOOK.z, yaw: 0 };

/** The load the site lists SECOND, the nearer of the two: the candidate. */
const NEAR = { x: HOOK.x + 0.3, y: HOOK.y, z: HOOK.z, yaw: 0 };

/** The index the site lists the nearer load at. */
const NEARER = 1;

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that keeps the run running past the `attach`. */
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

it("takes the nearest waiting load, not the first one listed", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await h.debug.addLoad("crate", 40, FAR.x, FAR.y, FAR.z, FAR.yaw);
  await h.debug.addLoad("crate", 40, NEAR.x, NEAR.y, NEAR.z, NEAR.yaw);
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);

  const taken = await runTicks(h, 1);
  await h.capture(
    "state",
    "two waiting loads in reach, at 0.6 and 0.3 from the hook point",
  );

  assertEqual(
    taken.run.attached,
    NEARER,
    "the load `attach` took: the waiting load nearest the hook point, which " +
      `the site lists at index ${NEARER}, 0.3 from the hook against the other's ` +
      `0.6, both inside ATTACH_RADIUS (${ATTACH_RADIUS}) ` +
      "(specs/rigging.md § Attaching)",
  );
  assertEqual(
    taken.run.loads[NEARER]?.phase,
    "attached",
    `load ${NEARER}, the nearer of the two, after the \`attach\``,
  );
  assertEqual(
    taken.run.loads[0]?.phase,
    "waiting",
    "load 0, the further of the two, after the `attach`: one load is attached " +
      "at a time (specs/rigging.md § Attaching)",
  );
});
