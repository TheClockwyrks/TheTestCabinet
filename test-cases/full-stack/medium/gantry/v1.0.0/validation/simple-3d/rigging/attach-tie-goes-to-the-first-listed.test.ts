// rigging/attach-tie-goes-to-the-first-listed — two candidates the same distance
// away, and the site's order settles it.
//
// specs/rigging.md § Attaching: the candidate is the waiting load nearest the hook
// point, "ties going to the one the site lists first". So the rule is total: a
// tape driven onto a symmetric yard has one answer, not two, and a build that
// broke a tie by whichever load its own search reached first would answer by
// its search order on exactly the yard this poses.
//
// THE TIE IS EXACT BY CONSTRUCTION. The hook is posed at the position the run
// starts it at — the pivot minus `(0, HOIST_START, 0)`, which the cable holds at
// its current length — and the two loads stand at `+0.5` and `-0.5` of it on one
// axis. Both separations are the same single coordinate, `0.5`, which is exact in
// binary and comes out of any distance formula identically, so nothing but the
// listing order can separate the two.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the `attach` is not the run's own first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { GRIP_MAX_RATE, HOIST_START, SLEW_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
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

/** Half a unit either side of the hook point: the same distance, exactly. */
const GAP = 0.5;

const FIRST = { x: HOOK.x + GAP, y: HOOK.y, z: HOOK.z, yaw: 0 };
const SECOND = { x: HOOK.x - GAP, y: HOOK.y, z: HOOK.z, yaw: 0 };

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

it("gives a tie between two candidates to the load the site lists first", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await h.debug.clearLoads();
  await h.debug.addLoad("crate", 40, FIRST.x, FIRST.y, FIRST.z, FIRST.yaw);
  await h.debug.addLoad("crate", 40, SECOND.x, SECOND.y, SECOND.z, SECOND.yaw);
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);

  const taken = await runTicks(h, 1);
  await h.capture(
    "state",
    `two waiting loads, each exactly ${GAP} from the hook point`,
  );

  assertEqual(
    taken.run.attached,
    0,
    `the load \`attach\` took with both candidates exactly ${GAP} from the ` +
      "hook point: the tie goes to the one the site lists first " +
      "(specs/rigging.md § Attaching)",
  );
  assertEqual(
    taken.run.loads[1]?.phase,
    "waiting",
    "the load the site lists second, after a tie it lost",
  );
});
