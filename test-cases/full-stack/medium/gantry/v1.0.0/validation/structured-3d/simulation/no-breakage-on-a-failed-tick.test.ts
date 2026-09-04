// simulation/no-breakage-on-a-failed-tick — a tick whose solve fails breaks
// nothing.
//
// specs/statics.md, The two solves: "The two solves and the ring check run in a
// fixed order, and the first of them to fail ends the run: the arm solve, whose
// singularity is a `collapse`; then the ring check on the arm's reactions, whose
// excess is a `ring-overload`; then the tower solve, whose singularity is a
// `collapse`. Only when all three pass are utilizations read and breakage
// decided."
//
// The crane below is built so that the tick has something to break and never gets
// to it. Its arm carries a member well past its capacity: the strut from the
// top-flange node `(2, 6, 2)` up to `(6, 8, 0)` is the only member at that node
// with a `y` component — the other two are horizontal — so it carries the whole
// weight lumped there, one `COUNTERWEIGHT_MASS` and the members' halves, through
// a direction that resolves it to about twice what a strut of that length bears
// in compression once `specs/structure.md` has reduced it for buckling. The
// static check says so out loud, and it is read first: a check "reports" a
// utilization above `1` "and no more", so the figure is on the record before any
// run starts.
//
// The tower is then taken down to its four bare legs. Four vertical members
// cannot resist a horizontal push at any of the four bottom-flange nodes, so the
// tower solve is a mechanism and its supported system is singular
// (`specs/statics.md`, Singularity) — while the arm solve above it is untouched
// and still regular, so the tick reaches the tower solve and fails there. The
// crane is still perfectly ready: it has its ring, its rail forms a track, and
// every member runs to an anchor or a flange node, so the run starts
// (`specs/program.md`).
//
// A build that read utilizations before the solves had all passed would break
// that strut on the way past and report it in `run.broken`.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertLength,
  assertTrue,
  fail,
} from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type MemberForce,
} from "../harness";

/**
 * A crane whose arm holds one member far past its capacity.
 *
 * The counterweight at `(6, 8, 0)` is carried by the strut back to `(2, 6, 2)`
 * alone: the two members tying that node to `(2, 8, 0)` and `(2, 8, 2)` are
 * horizontal, so they take the strut's sideways thrust and none of the weight.
 * Its tower is the four legs from the anchors to the bottom flange and nothing
 * else — every other member is above the ring — so the tower solve has four nodes
 * held only against sinking.
 */
const OVERLOADED: CraneDesign = {
  site: 1,
  name: "Overloaded arm on a bare tower",
  ring: [0, 4, 0],
  counterweights: [[6, 8, 0]],
  members: [
    // The tower: four legs, and no bracing at all.
    [[0, 0, 0], [0, 4, 0], "strut"],
    [[2, 0, 0], [2, 4, 0], "strut"],
    [[0, 0, 2], [0, 4, 2], "strut"],
    [[2, 0, 2], [2, 4, 2], "strut"],
    // Two nodes above the top flange, each tied to three of its corners.
    [[2, 6, 0], [2, 8, 0], "strut"],
    [[0, 6, 0], [2, 8, 0], "strut"],
    [[2, 6, 2], [2, 8, 0], "strut"],
    [[2, 6, 2], [2, 8, 2], "strut"],
    [[0, 6, 2], [2, 8, 2], "strut"],
    [[2, 6, 0], [2, 8, 2], "strut"],
    [[2, 8, 0], [2, 8, 2], "strut"],
    // The counterweight's node: two horizontal ties, and one strut that carries
    // the whole of its weight.
    [[2, 8, 0], [6, 8, 0], "strut"],
    [[2, 8, 2], [6, 8, 0], "strut"],
    [[2, 6, 2], [6, 8, 0], "strut"],
    // The track, and the two members that hold its far node up and sideways.
    [[2, 6, 0], [4, 6, 0], "rail"],
    [[2, 8, 0], [4, 6, 0], "strut"],
    [[2, 6, 2], [4, 6, 0], "strut"],
  ],
  tape: [],
};

/** The arm member the counterweight drives past its capacity. */
const OVERLOADED_MEMBER = 13;

/** The bracing that makes the tower's solve regular, for the first reading. */
const TOWER_BRACING = [
  [
    [0, 4, 0],
    [2, 4, 0],
  ],
  [
    [0, 4, 2],
    [2, 4, 2],
  ],
  [
    [0, 4, 0],
    [0, 4, 2],
  ],
  [
    [2, 4, 0],
    [2, 4, 2],
  ],
  [
    [0, 4, 0],
    [2, 4, 2],
  ],
  [
    [0, 0, 0],
    [2, 4, 0],
  ],
  [
    [0, 0, 0],
    [0, 4, 2],
  ],
  [
    [2, 0, 0],
    [2, 4, 2],
  ],
  [
    [0, 0, 2],
    [2, 4, 2],
  ],
] as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The utilization the reported member list carries for `id`. */
function utilizationOf(members: readonly MemberForce[], id: number): number {
  const found = members.find((one) => one.id === id);
  if (found === undefined) {
    fail(`member ${id} to be reported (specs/state.md)`, "it is missing");
  }
  return found.utilization;
}

it("adds nothing to the broken list on the tick a solve fails", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await poseCrane(h, OVERLOADED);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE }],
    },
  ]);

  // With the tower braced the crane stands, so the check reports the arm member
  // this run is about — and reports it well past its capacity.
  for (const [a, b] of TOWER_BRACING) {
    await h.debug.addMember(a[0], a[1], a[2], b[0], b[1], b[2], "strut");
  }
  const braced = await h.check();
  assertTrue(
    braced.stable,
    "the braced crane to stand, so the check reports its members " +
      "(specs/structure.md)",
  );
  assertGreaterThan(
    utilizationOf(braced.members, OVERLOADED_MEMBER),
    1,
    "the utilization of the strut carrying the counterweight, which is what " +
      "would break if breakage were decided (specs/statics.md)",
  );

  // Take the bracing away: the tower is a mechanism, and the arm above it is
  // untouched.
  for (let id = 0; id < TOWER_BRACING.length; id += 1) {
    await h.debug.removeMember(OVERLOADED.members.length + id);
  }
  const bare = await h.check();
  assertTrue(
    !bare.stable,
    "the crane to stand once the tower is four bare legs (specs/statics.md)",
  );

  await startRun(h);
  const s = await runTicks(h, 1);
  await h.capture(
    "failed-tick",
    "the run the singular tower solve ended on its first tick",
  );

  assertEqual(
    s.run.phase,
    "failed",
    "the run's phase on the tick the tower solve went singular " +
      "(specs/statics.md)",
  );
  assertEqual(
    s.run.cause,
    "collapse",
    "the cause a singular solve gives the run (specs/statics.md)",
  );
  assertLength(
    s.run.broken,
    0,
    "the members broken on a tick that never reached breakage " +
      "(specs/statics.md)",
  );
});
