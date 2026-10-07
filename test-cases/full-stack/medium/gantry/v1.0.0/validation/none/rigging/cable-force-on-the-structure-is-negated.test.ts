// rigging/cable-force-on-the-structure-is-negated — the rigging presses DOWN on
// the crane at the pivot, and harder as the bob grows heavier.
//
// `specs/rigging.md` § Cable tension and snapping: "the force the rigging applies
// to the structure at the pivot is `-T`, which is the cable force
// `specs/statics.md` applies at the trolley point. Hanging at rest this is the
// bob's weight, straight down." The sign is the whole of this point: `T` is what
// the constraint applied to the bob, so what the bob applies to the crane is its
// negative, and a build that applied `+T` there would have a heavier bob RELIEVE
// the structure instead of loading it.
//
// THE COMPARISON IS AGAINST A WEIGHT ON THE SAME NODE. The trolley starts at the
// track origin, `(0, 4, 0)` on the harness's minimal crane, and the cable force
// is shared between the rail member's two nodes "linearly by its position along
// that member; at a shared node it belongs wholly to that node"
// (`specs/statics.md`), so it lands on that one node. A counterweight placed
// there applies `COUNTERWEIGHT_MASS * GRAVITY` (`800`) straight down on it
// (§ The load model, at `a = 0`), and each solve is one linear system at a
// prescribed geometry, so the member forces the counterweight moves are `800`
// newtons' worth of that node's response — in the direction a downward force
// moves them.
//
// SO THE THREE READINGS. The bare hook hanging at rest, the same crane carrying
// one counterweight, and the bare crane again with a load of `LOAD_MASS` (`75`)
// hung on the hook. Hanging the load adds `LOAD_MASS * GRAVITY` (`750`) to the
// bob's weight, so if the rigging presses down with it, every member force must
// move by `750/800` of what the counterweight moved it by — same direction, and
// that fraction of the size. A build applying `+T` moves them the other way, by
// `-750/800`, and fails by twice the signal.
//
// THE BOB IS AT REST FOR EVERY READING, so `a` is zero and `T` is the weight
// alone — and it is at rest from the first tick rather than settled into rest: a
// run starts with the hoist at `HOIST_START` (`2`) and "the bob hangs at rest
// directly below the pivot" there (`specs/rigging.md`, `specs/state.md`), which
// leaves the `2`-unit crate riding a unit clear of the ground once it is on the
// hook (`specs/world.md`, `specs/statics.md`). Nothing is driven toward the
// reading that the run does not already stand at, so the readings are taken a few
// ticks in rather than a second in. The load is hung with
// `setLoadPhase(0, "attached")`, which "hangs that load on the hook exactly as a
// successful `attach` leaves it" (`specs/instrumentation.md`), so the tape is the
// same in all three runs and the loaded run differs from the bare one in the bob's
// mass and in nothing else.
//
// The crane is struts and rails alone, so no cable can go slack and each solve is
// one linear system; the yard holds that one load and no obstacle; and the tape is
// one long grip move, the only axis whose motion moves neither the pivot nor the
// cable ("Turning the grip applies no force to anything").

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear } from "../assert";
import { COUNTERWEIGHT_MASS, GRIP_MAX_RATE, HOIST_START } from "../constants";
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

/** The track origin of the harness's minimal crane: the trolley's own node. */
const TRACK_ORIGIN = { x: 0, y: 4, z: 0 };

/** Where the hook stands at the run-start posture: HOIST_START below the pivot. */
const HOOK = { x: 0, y: TRACK_ORIGIN.y - HOIST_START, z: 0, yaw: 0 };

/** The mass hung on the hook: near the counterweight's, and not equal to it. */
const LOAD_MASS = 75;

/** Hold: the grip is the one axis whose motion moves nothing the rigging touches. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 360, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven before a reading: enough for a solve, on a run already at rest. */
const SETTLE = 3;

/** Newtons of slack on a force every reading takes at rest. */
const TOLERANCE = 0.01;

/** The calibration has to carry real signal for the comparison to say anything. */
const MIN_SIGNAL = 100;

/** A solve's forces, by member id. */
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

it("loads the crane downward as the hanging bob grows heavier", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);

  // The bare hook, hanging at rest: the baseline both readings are taken from.
  await startRun(h);
  const bare = (await runTicks(h, SETTLE)).run;

  // The calibration: one counterweight on the node the cable force lands on.
  await h.debug.abortRun();
  await h.debug.addCounterweight(
    TRACK_ORIGIN.x,
    TRACK_ORIGIN.y,
    TRACK_ORIGIN.z,
  );
  await startRun(h);
  const weighted = (await runTicks(h, SETTLE)).run;

  // The load: the bare crane again, with the crate hung on the hook.
  await h.debug.abortRun();
  await h.debug.removeCounterweight(
    TRACK_ORIGIN.x,
    TRACK_ORIGIN.y,
    TRACK_ORIGIN.z,
  );
  await startRun(h);
  await runTicks(h, SETTLE);
  await h.debug.setLoadPhase(0, "attached");
  const loaded = (await runTicks(h, 2)).run;

  await h.capture("loaded", "The crane loaded by the hanging bob");

  const bareForces = byId(bare.forces);
  const weightedForces = byId(weighted.forces);
  const loadedForces = byId(loaded.forces);
  const ratio = LOAD_MASS / COUNTERWEIGHT_MASS;

  let signal = 0;
  for (const [id, force] of weightedForces) {
    signal = Math.max(signal, Math.abs(force - (bareForces.get(id) ?? 0)));
  }
  assertGreaterThan(
    signal,
    MIN_SIGNAL,
    "the largest member force the counterweight moved, which is what a " +
      "downward newton at the trolley point is measured in (specs/statics.md)",
  );

  for (const [id, force] of bareForces) {
    const weighed = (weightedForces.get(id) ?? 0) - force;
    assertNear(
      (loadedForces.get(id) ?? 0) - force,
      weighed * ratio,
      TOLERANCE,
      `member ${id}: the force hanging a load of ${LOAD_MASS} moved, which ` +
        `is ${ratio} of what the same weight standing on that node moves it ` +
        "— the rigging pressing down on the structure with -T rather than " +
        "relieving it with +T (specs/rigging.md)",
    );
  }
});
