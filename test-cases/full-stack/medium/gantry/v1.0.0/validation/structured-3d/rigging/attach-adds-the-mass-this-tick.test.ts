// rigging/attach-adds-the-mass-this-tick — the attach tick's own solve already
// carries the load.
//
// specs/rigging.md § Attaching says exactly when the mass arrives: "the bob's mass
// includes the load's from this tick's pendulum step on, which runs later in the
// tick than the action does". specs/program.md § The tick pipeline is what makes
// that a testable claim — the tape is stage 1, the rigging stage 4 and the solves
// stage 6 — so the cable force the structure is solved against on the attach tick
// is already `HOOK_MASS + the load's`, and a build that only starts counting the
// load on the following tick under-loads its crane for a tick every time a lift
// begins.
//
// THE READING IS THREE CONSECUTIVE TICKS OF ONE RUN, and it needs no control run
// because the run supplies its own. Nothing in this scenario moves: the crane
// stands still, the bob hangs at rest below a still pivot, and the load waits at
// the hook point, so the only thing that ever changes is which mass the cable is
// carrying. Then:
//
//   - the tick BEFORE the action is the bare hook, `HOOK_MASS` (`5`);
//   - the tick the action executes must already be the laden bob, `45`;
//   - the tick AFTER it is unarguably the laden bob.
//
// So the attach tick's forces are compared against the tick after it. A build that
// adds the mass a tick late answers the tick BEFORE it instead, and the two differ
// by the load's `400` of weight at the trolley point — which the last assertion
// measures, so the agreement above is a reading of something rather than of a
// crane nothing ever changed.
//
// The tape opens with a move whose target is the axis's current value, which
// specs/program.md § Axis motion says "is done on the tick it is issued": one tick
// that changes nothing, so the attach is not the run's first tick, whose
// acceleration specs/rigging.md exempts. It closes with a long `grip` move, the
// only axis whose motion moves neither the pivot nor the cable ("Turning the grip
// applies no force to anything"), so the tick after the attach is as still as the
// attach tick itself.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import {
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_START,
  HOOK_MASS,
  SLEW_MAX_RATE,
} from "../constants";
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
  type MemberForce,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the hook is posed: where the run starts it, so the cable holds it. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z };

/** The load waiting at the hook point, so the lift moves the bob not at all. */
const LOAD_MASS = 40;
const LOAD_AT = { x: HOOK.x, y: HOOK.y, z: HOOK.z, yaw: 0 };

/**
 * How close two solves of a crane nothing moved have to come.
 *
 * Both ticks assemble the same stiffness over the same geometry against the same
 * applied forces, so what separates them is nothing at all; what this is here to
 * catch is the load's `400` of weight arriving a tick late.
 */
const TOLERANCE = 1e-6;

const NOOP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 0, rate: SLEW_MAX_RATE }],
};

const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** A move that keeps the run running past the attach, and moves nothing. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/** The member forces of a tick, by member id. */
function byId(forces: readonly MemberForce[]): Map<number, number> {
  return new Map(forces.map((one) => [one.id, one.force]));
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("solves the attach tick against the bob the load is already part of", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, LOAD_AT, LOAD_AT);
  await poseTape(h, [NOOP, ATTACH, HOLD]);

  await startRun(h);
  const beforeRead = await runTicks(h, 1);
  await h.debug.setBob(HOOK.x, HOOK.y, HOOK.z);
  const attachRead = await runTicks(h, 1);
  const afterRead = await runTicks(h, 1);
  await h.capture("attach", "the attach tick and the ticks either side of it");

  assertEqual(
    attachRead.run.attached,
    0,
    "the load `attach` took on the tick under test",
  );
  assertEqual(
    afterRead.run.phase,
    "running",
    "the run on the tick after the lift",
  );

  const before = byId(beforeRead.run.forces);
  const attach = byId(attachRead.run.forces);
  const after = byId(afterRead.run.forces);
  assertGreaterThan(attach.size, 0, "the members a standing crane reports");

  let moved = 0;
  for (const [id, force] of attach) {
    assertNear(
      force,
      after.get(id) as number,
      TOLERANCE,
      `member ${id}'s force on the tick the \`attach\` executed, against its ` +
        "force on the tick after: the bob's mass includes the load's from " +
        "THIS tick's pendulum step on, which runs later in the tick than the " +
        "action does (specs/rigging.md § Attaching)",
    );
    moved = Math.max(moved, Math.abs(force - (before.get(id) as number)));
  }

  assertGreaterThan(
    moved,
    1,
    `the largest member force the load's ${LOAD_MASS * GRAVITY} of weight ` +
      `moved between the tick before the lift, when the bob was ` +
      `${HOOK_MASS}, and the lift's own tick, when it was ` +
      `${HOOK_MASS + LOAD_MASS}`,
  );
});
