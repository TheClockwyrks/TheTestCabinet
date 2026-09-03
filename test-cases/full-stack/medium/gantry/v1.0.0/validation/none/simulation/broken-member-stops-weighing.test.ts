// simulation/broken-member-stops-weighing — a broken member's mass leaves the
// nodes it hung on.
//
// specs/statics.md lumps mass at nodes from the members that are still there:
// "Each node's mass is half of every intact member ending at it", and breakage
// removes members "at once, permanently for the rest of the run", after which
// "Both solves then run again at the same tick, over the members still intact, with
// the lumped masses and the applied forces recomputed for them". So from the break
// on, the halves of the broken member's mass that stood at its two ends are gone —
// a build that kept them would carry a ghost.
//
// The crane is a tower whose anchor at `(2, 0, 0)` carries several parallel paths
// up to the ring: a length-6 leg straight to the bottom flange, a length-4 leg to
// an inner frame, and a stack through `(2, 2, 0)`. specs/structure.md allows the
// long leg to run past the nodes it crosses — "two members whose segments cross in
// space are not joined there and pass through one another freely" — and it is the
// weakest of them, because a strut's compression capacity falls as
// `min(1, (BUCKLE_REF / L)^2)` and at length 6 that is `4 / 9` of
// `STRUT_CAP_COMPRESSION`. Four counterweights load that corner until the long leg
// alone goes past its capacity; it breaks, the paths beside it take up its load,
// and the run carries on.
//
// The same run is then driven over a crane built without that leg at all. Once the
// leg has broken, the two structures are the same structure carrying the same
// loads, so every surviving member must report the same force. A build that left
// the broken leg's mass on `(2, 0, 0)` and `(2, 6, 0)` would differ by half that
// leg's weight at each of them — `6 * STRUT_MASS_PER_UNIT / 2 * GRAVITY`, twenty-
// four force units — which is far outside the span these forces are read to.
//
// Nothing moves in either run: the trolley stands at the track origin, the bare
// hook hangs at rest, and the tape's one move turns the grip, which
// specs/rigging.md says "applies no force to anything". So the comparison is
// between two static solves and carries no pendulum state at all.
//
// ONE CRANE CARRIES BOTH RUNS. The second is not rebuilt: the first run is
// aborted, which "ends a running run with no verdict" and returns the build
// screen (specs/instrumentation.md), and the leg that broke is REMOVED there —
// "removal is always allowed", and a run leaves the structure it ran over
// untouched, "every run begins from the same authored state" (specs/program.md),
// so the leg is back before it comes off. Every other member therefore keeps the
// id it had, and the crane the second run solves is demonstrably the first crane
// minus that one leg rather than a second crane this file asserts is the same.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The span a force in the thousands is read to. */
const TOLERANCE = 1e-6;

/** The leg that breaks: length 6, so its compression capacity is 4/9 of a strut's. */
const BREAKER: DesignMember = [[2, 0, 0], [2, 6, 0], "strut"];

/** Everything else, which both cranes carry. */
const REST: readonly DesignMember[] = [
  // The other three long legs, anchor to the ring's bottom flange at y = 6.
  [[0, 0, 0], [0, 6, 0], "strut"],
  [[0, 0, 2], [0, 6, 2], "strut"],
  [[2, 0, 2], [2, 6, 2], "strut"],
  // The length-4 legs, to an inner frame the long legs run past.
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  // The inner frame at y = 4, and its anchor braces.
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 2], "strut"],
  [[0, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [2, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 0], "strut"],
  // The frame up to the bottom flange, and the flange square.
  [[0, 4, 0], [0, 6, 0], "strut"],
  [[2, 4, 0], [2, 6, 0], "strut"],
  [[0, 4, 2], [0, 6, 2], "strut"],
  [[2, 4, 2], [2, 6, 2], "strut"],
  [[0, 6, 0], [2, 6, 0], "strut"],
  [[0, 6, 2], [2, 6, 2], "strut"],
  [[0, 6, 0], [0, 6, 2], "strut"],
  [[2, 6, 0], [2, 6, 2], "strut"],
  [[0, 6, 0], [2, 6, 2], "strut"],
  [[0, 4, 0], [2, 6, 0], "strut"],
  [[0, 4, 2], [2, 6, 2], "strut"],
  [[2, 4, 2], [2, 6, 0], "strut"],
  // The stack beside the long leg, so its load has somewhere else to go.
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[2, 2, 0], [2, 4, 0], "strut"],
  [[2, 2, 0], [2, 6, 0], "strut"],
  [[2, 2, 0], [0, 0, 0], "strut"],
  [[2, 2, 0], [0, 0, 2], "strut"],
  [[2, 2, 0], [2, 0, 2], "strut"],
  [[2, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 2], "strut"],
  [[2, 2, 0], [0, 4, 0], "strut"],
  [[2, 2, 0], [2, 4, 2], "strut"],
  [[2, 2, 0], [0, 4, 2], "strut"],
  // The jib on the top flange: a mast head, two rails, and their hangers.
  [[2, 8, 0], [2, 12, 0], "strut"],
  [[2, 12, 0], [2, 8, 2], "strut"],
  [[2, 12, 0], [0, 8, 2], "strut"],
  [[2, 12, 0], [0, 8, 0], "strut"],
  [[2, 8, 0], [4, 8, 0], "rail"],
  [[4, 8, 0], [6, 8, 0], "rail"],
  [[2, 12, 0], [4, 8, 0], "strut"],
  [[2, 12, 0], [6, 8, 0], "strut"],
  [[4, 8, 0], [2, 8, 2], "strut"],
  [[6, 8, 0], [2, 8, 2], "strut"],
];

/** The load that takes the long leg past its capacity, and nothing else. */
const COUNTERWEIGHTS = [
  [2, 6, 0],
  [2, 4, 0],
  [2, 2, 0],
  [6, 8, 0],
] as const;

const CRANE: CraneDesign = {
  site: 1,
  name: "Overloaded-leg tower",
  ring: [0, 6, 0],
  counterweights: COUNTERWEIGHTS,
  members: [BREAKER, ...REST],
  tape: [],
};

/** Ticks the overloaded leg is given to go: it is over capacity from the first. */
const BREAK_CAP = 60;

/** Ticks the crane without that leg is settled for, matching the first run's. */
const SETTLE = 12;

/** One move that turns the hook and applies no force (specs/rigging.md). */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }],
  },
];

/** A member's two nodes, in an order that reads the same either way round. */
function key(a: Vec3, b: Vec3): string {
  const one = a.x + "," + a.y + "," + a.z;
  const two = b.x + "," + b.y + "," + b.z;
  return one < two ? one + "|" + two : two + "|" + one;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("drops a broken member's mass from the nodes it hung on", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const nodes = new Map(
    started.structure.members.map((m) => [m.id, key(m.a, m.b)]),
  );

  /** What the run is carrying right now, keyed by node pair. */
  const forcesNow = async (what: string) => {
    // A tick beyond the reading point, so what is read is a settled solve.
    await h.advance(2);
    const after = await h.snapshot();
    assertTrue(
      after.run.phase === "running",
      "the run " +
        what +
        " carrying on rather than ending " +
        "(broken: [" +
        after.run.broken.join(", ") +
        "], cause: " +
        String(after.run.cause) +
        ")",
    );
    return {
      after,
      forces: new Map(
        after.run.forces.map((f) => [nodes.get(f.id) ?? String(f.id), f.force]),
      ),
    };
  };

  // The crane with the leg: it is over capacity from the first solve, so it goes,
  // and the paths beside it take up its load.
  await runUntil(
    h,
    (s) => s.run.broken.length > 0,
    BREAK_CAP,
    "the overloaded leg to break",
  );
  const withLeg = await forcesNow("after the break");
  assertLength(
    withLeg.after.run.broken,
    1,
    "the members that broke: the overloaded leg alone",
  );
  const breakerId = withLeg.after.run.broken[0] as number;
  assertEqual(
    nodes.get(breakerId),
    key(
      { x: BREAKER[0][0], y: BREAKER[0][1], z: BREAKER[0][2] },
      { x: BREAKER[1][0], y: BREAKER[1][1], z: BREAKER[1][2] },
    ),
    "the member that broke",
  );
  const broken = withLeg.forces;

  // The same crane with that leg taken off it, standing from the start. The run
  // is aborted first: nothing is posed while a run is in progress
  // (specs/instrumentation.md), and the abort returns the build screen.
  await h.debug.abortRun();
  await h.debug.removeMember(breakerId);
  const stripped = await h.snapshot();
  assertLength(
    stripped.structure.members,
    CRANE.members.length - 1,
    "the members left once the leg that broke is removed from the crane " +
      "(specs/structure.md)",
  );
  await startRun(h);
  await runTicks(h, SETTLE);
  const withoutLeg = await forcesNow("of the crane built without that leg");
  assertLength(
    withoutLeg.after.run.broken,
    0,
    "the members that broke in the crane built without that leg",
  );
  const reference = withoutLeg.forces;

  for (const [where, force] of reference) {
    const survived = broken.get(where);
    if (survived === undefined) {
      throw new Error("gantry: the broken crane reports no member at " + where);
    }
    assertNear(
      survived,
      force,
      Math.max(Math.abs(force), 1) * TOLERANCE,
      "the member at " +
        where +
        " carrying, once the overloaded leg has " +
        "broken, exactly what it carries in the crane that never had that leg " +
        "— the broken member's half-masses are gone from its two end nodes " +
        "(specs/statics.md)",
    );
  }

  await h.capture(
    "after-the-break",
    "The tower standing on the paths beside the leg that broke",
  );
});
