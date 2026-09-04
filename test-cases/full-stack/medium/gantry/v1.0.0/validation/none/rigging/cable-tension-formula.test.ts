// rigging/cable-tension-formula — at rest the cable puts the bob's weight, and
// exactly the bob's weight, on the structure.
//
// specs/rigging.md § Cable tension and snapping gives the vector and what becomes
// of it: "`T = m * (a - g)` with `m` the bob's mass", and "the force the rigging
// applies to the structure at the pivot is `-T`, which is the cable force
// `specs/statics.md` applies at the trolley point. Hanging at rest this is the
// bob's weight, straight down."
//
// AT REST THE FORMULA HAS AN EXACT CONSEQUENCE, AND THAT IS WHAT IS MEASURED. A
// bob hanging still below a still pivot has `a = 0`, so `T = -m * g` and
// `-T = m * g`: a downward force of `m * GRAVITY` at the trolley point, and
// nothing else. specs/statics.md § The load model applies a lumped mass at a node
// as `F = m * g - m * a`, which at `a = 0` is that same downward `m * GRAVITY`.
// So a bob of mass `m` hanging at rest from the trolley point and a static mass
// `m` sitting on the trolley point's node are, to the solve, THE SAME APPLIED
// FORCE — and the whole structure must answer with the same member forces, member
// for member, to the last bit the arithmetic carries.
//
// THAT IS THE COMPARISON. The trolley starts at the track origin, `(0, 4, 0)` on
// the harness's minimal crane, and "at a shared node it belongs wholly to that
// node", so the cable force lands on one node and one node only. The two runs
// are:
//
//   - the cable: the bare crane, with a load of `COUNTERWEIGHT_MASS` (`80`) hung
//     on the hook, so the bob weighs `HOOK_MASS + 80` (`85`) and the cable puts
//     `850` down on `(0, 4, 0)`;
//   - the counterweight: the same crane carrying one counterweight on `(0, 4, 0)`
//     — `COUNTERWEIGHT_MASS` of static mass, `800` down on that node — with the
//     load left waiting in the yard, so the bare hook adds the remaining `50`.
//
// Both put `850` down on that one node and nothing anywhere else, so every member
// force in the two runs must agree. A build that left the load's mass out of the
// bob, or applied `+T` rather than `-T`, or used `m * a` in place of
// `m * (a - g)`, answers a different force at that node and fails.
//
// THE BARE-HOOK READING IS TAKEN TOO, so the agreement is not vacuous: the run's
// own forces before the load is hung differ from both, which is what says the
// `800` the comparison is about actually reached the structure.
//
// ONE CRANE CARRIES BOTH RUNS. The second is not rebuilt: the first run is
// aborted, which "ends a running run with no verdict" and returns the build
// screen (`specs/instrumentation.md`), and the counterweight goes on there.
// A run leaves the structure, the tape and the loads' starting poses untouched —
// "every run begins from the same authored state" (`specs/program.md`) — so the
// load is back in the yard waiting and the crane the second run solves is
// demonstrably the crane the first one solved, plus that one counterweight,
// rather than two cranes this file asserts are the same.
//
// The crane is struts and rails alone, so no cable can go slack and each solve is
// one linear system, and the tape is one long `grip` move — the only axis whose
// motion moves neither the pivot nor the cable ("Turning the grip applies no
// force to anything") — so the bob is genuinely at rest for every reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNear } from "../assert";
import {
  COUNTERWEIGHT_MASS,
  GRAVITY,
  GRIP_MAX_RATE,
  HOIST_START,
  HOOK_MASS,
} from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type MemberForce,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the bob hangs at the run's start: the pivot minus `(0, L, 0)`. */
const HOOK_AT = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** The load hung on the hook: exactly what a counterweight weighs. */
const LOAD_MASS = COUNTERWEIGHT_MASS;

/** A move that keeps the run running and moves neither pivot nor cable. */
const HOLD: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
};

/**
 * How close two solves of the same applied forces have to come.
 *
 * The two runs assemble the same stiffness over the same geometry and differ
 * only in how the `850` at `(0, 4, 0)` was summed, so what separates them is
 * floating-point association and nothing else — some ten orders of magnitude
 * below this — while what it is here to catch, a bob of the wrong mass, is `800`
 * force units.
 */
const TOLERANCE = 1e-6;

/** The member forces of a run, by member id. */
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

it("puts the bob's weight on the structure, as a static mass would", async () => {
  // The cable: a bob of HOOK_MASS + LOAD_MASS hanging at rest from (0, 4, 0).
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, MINIMAL_CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK_AT, HOOK_AT);
  await poseTape(h, [HOLD]);
  await startRun(h);
  const bareRead = await runTicks(h, 2);
  await h.debug.setLoadPhase(0, "attached");
  const cableRead = await runTicks(h, 2);
  await h.capture("rest", "the crane with the load hanging at rest");

  assertEqual(
    cableRead.run.phase,
    "running",
    `the run carrying a bob of ${HOOK_MASS + LOAD_MASS} at rest`,
  );

  // The counterweight: the same crane with COUNTERWEIGHT_MASS on that node, the
  // load left waiting, so the same 850 stands on the same node. The run is
  // aborted, which returns the build screen the structure poses apply on, and the
  // counterweight goes on the crane that just ran.
  await h.debug.abortRun();
  await h.debug.addCounterweight(PIVOT.x, PIVOT.y, PIVOT.z);
  const weighted = await h.snapshot();
  assertEqual(
    weighted.structure.counterweights.length,
    1,
    `the counterweight standing on the track origin (specs/structure.md)`,
  );
  assertEqual(
    weighted.structure.members.length,
    MINIMAL_CRANE.members.length,
    "the members of the crane the first run solved, untouched by it " +
      "(specs/program.md)",
  );
  await startRun(h);
  const staticRead = await runTicks(h, 4);

  assertEqual(
    staticRead.run.phase,
    "running",
    `the run carrying ${COUNTERWEIGHT_MASS} of counterweight on the trolley ` +
      "point's node",
  );

  const cable = byId(cableRead.run.forces);
  const bare = byId(bareRead.run.forces);
  const still = byId(staticRead.run.forces);
  assertEqual(
    cable.size,
    still.size,
    "the members the two runs report forces for",
  );
  assertGreaterThan(cable.size, 0, "the members a standing crane reports");

  let moved = 0;
  for (const [id, force] of cable) {
    const staticForce = still.get(id);
    assertEqual(
      staticForce === undefined,
      false,
      `member ${id} among the counterweight-carrying run's forces`,
    );
    assertNear(
      force,
      staticForce as number,
      TOLERANCE,
      `member ${id}'s force with a bob of ${HOOK_MASS + LOAD_MASS} hanging at ` +
        `rest, against the same crane carrying ${COUNTERWEIGHT_MASS} of static ` +
        `mass on the trolley point: at rest the cable applies the bob's ` +
        `weight, ${(HOOK_MASS + LOAD_MASS) * GRAVITY}, straight down ` +
        "(specs/rigging.md § Cable tension and snapping)",
    );
    moved = Math.max(moved, Math.abs(force - (bare.get(id) as number)));
  }

  assertGreaterThan(
    moved,
    1,
    `the largest member force the load's ${LOAD_MASS * GRAVITY} of weight ` +
      "moved, so the agreement above is a reading of that weight rather than " +
      "of nothing at all",
  );
});
