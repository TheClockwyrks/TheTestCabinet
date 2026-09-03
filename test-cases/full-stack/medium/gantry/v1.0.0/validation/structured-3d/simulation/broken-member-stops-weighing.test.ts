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

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNear, assertTrue } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
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

function crane(withBreaker: boolean): CraneDesign {
  return {
    site: 1,
    name: withBreaker ? "Overloaded-leg tower" : "Tower without that leg",
    ring: [0, 6, 0],
    counterweights: COUNTERWEIGHTS,
    members: withBreaker ? [BREAKER, ...REST] : REST,
    tape: [],
  };
}

/** One move that turns the hook and applies no force (specs/rigging.md). */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }] },
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

  /** Run one of the two cranes and answer its forces, keyed by node pair. */
  const forcesOf = async (withBreaker: boolean) => {
    // Nothing is posed while a run is in progress (specs/instrumentation.md), so
    // the run the previous crane left is ended before the next one is built.
    await h.debug.abortRun();
    await clearAll(h);
    await poseCrane(h, crane(withBreaker));
    await poseTape(h, TAPE);
    const started = await startRun(h);
    const nodes = new Map(
      started.structure.members.map((m) => [m.id, key(m.a, m.b)]),
    );
    const state = withBreaker
      ? await runUntil(
          h,
          (s) => s.run.broken.length > 0,
          120,
          "the overloaded leg to break",
        )
      : await runUntil(h, (s) => s.run.tick >= 10, 120, "ten ticks of the run");
    // A tick beyond the break, so what is read is the solve that follows it.
    await h.advance(2);
    const after = await h.snapshot();
    assertTrue(
      after.run.phase === "running",
      "the run carrying on after the break rather than ending " +
        "(broken: [" + after.run.broken.join(", ") + "], cause: " +
        String(after.run.cause) + ")",
    );
    if (withBreaker) {
      assertLength(
        after.run.broken,
        1,
        "the members that broke: the overloaded leg alone",
      );
      assertEqual(
        nodes.get(after.run.broken[0] as number),
        key(
          { x: BREAKER[0][0], y: BREAKER[0][1], z: BREAKER[0][2] },
          { x: BREAKER[1][0], y: BREAKER[1][1], z: BREAKER[1][2] },
        ),
        "the member that broke",
      );
    } else {
      assertLength(
        after.run.broken,
        0,
        "the members that broke in the crane built without that leg",
      );
    }
    void state;
    return new Map(
      after.run.forces.map((f) => [nodes.get(f.id) ?? String(f.id), f.force]),
    );
  };

  const broken = await forcesOf(true);
  const reference = await forcesOf(false);

  for (const [where, force] of reference) {
    const survived = broken.get(where);
    if (survived === undefined) {
      throw new Error("gantry: the broken crane reports no member at " + where);
    }
    assertNear(
      survived,
      force,
      Math.max(Math.abs(force), 1) * TOLERANCE,
      "the member at " + where + " carrying, once the overloaded leg has " +
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
