// rigging/rigging-reads-only-the-pivot-and-the-length — the swing does not know
// what is holding the cable up.
//
// specs/rigging.md, Determinism: "The rigging has no randomness and reads nothing
// but the pivot, the hoist length, and its own state". The pendulum tick above it
// is written in exactly those terms — `P`, `P_prev`, `L`, `p` and `v` — and the
// tension follows from what the constraint did to the bob. Nothing in it reaches
// for a member, a mass, a reaction or a utilization.
//
// SO TWO CRANES THAT CARRY THE PIVOT ALONG THE SAME PATH MUST SWING ALIKE. The
// two built here share the ring at `(0, 2, 0)` and the single rail from
// `(0, 4, 0)` to `(4, 4, 0)`, and `specs/statics.md` fixes the pivot from those
// alone — the trolley point on the track, at the trolley's position, turned by
// the slew angle — so both runs put `P` in the same place on every tick. What
// differs is everything else: the second crane carries two more tower diagonals,
// another tie out along the arm, and a `COUNTERWEIGHT_MASS` block on a bottom
// flange node, so its lumped masses, its member forces and its reactions are not
// the first one's anywhere. A build that let any of that reach the swing —
// damping a heavier crane's bob, or carrying a member's deflection into the
// pivot — parts the two paths.
//
// THE AXES ARE READ ALONGSIDE THE BOB, because the pivot's path is the axes'
// path: `specs/program.md`'s controller reads the tape, the axis's own state and,
// for the trolley, the length of the track the intact rails form, and both cranes
// carry the same track. Two runs whose axes agreed but whose bobs did not would
// have moved the same pivot to different ends.
//
// THE TAPE MOVES THE PIVOT BOTH WAYS IT CAN — a slew of forty degrees and a
// trolley run of three units, together — because a bob left hanging under a still
// pivot agrees with itself trivially. It then turns the grip, the one axis the
// rigging cannot feel, which keeps both runs ticking for the whole sample without
// touching the pivot or the cable.
//
// THE YARD IS EMPTY on both. A load is a mass on the bob, and this point is about
// what the rigging reads off the STRUCTURE; the bare hook swings under exactly
// the same steps.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SLEW_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift: both cranes stand on it, and its yard is emptied. */
const SITE = 0;

/**
 * The other crane: the same ring, the same rail, a different everything else.
 *
 * Bracing is ADDED rather than swapped out. `specs/structure.md` leaves an
 * under-braced truss a mechanism, and a crane that collapsed would be reporting
 * another point's failure; every node here already carries members, so each
 * addition is accepted (both ends on the lattice, inside site 1's envelope, no
 * pair joined twice, no path opened between the arm and the tower outside the
 * ring) and the cost stays far inside the site's budget of `3000`.
 */
const OTHER_CRANE: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Braced",
  // A bottom-flange node of the ring: a node the structure uses, so the block
  // is accepted, and a tower node, so it "simply weighs the tower down".
  counterweights: [[2, 2, 0]],
  members: [
    ...MINIMAL_CRANE.members,
    // Two more diagonals across the tower, each between an anchor and the far
    // bottom flange node.
    [[2, 0, 0], [0, 2, 2], "strut"],
    [[0, 0, 2], [2, 2, 0], "strut"],
    // One more tie along the arm, from a top flange node out to the rail tip.
    [[2, 4, 0], [4, 4, 0], "strut"],
  ],
};

/** Ticks of run watched on both cranes. */
const SAMPLES = 120;

/**
 * The tape both cranes run: the pivot swung and run out, then a long grip turn.
 *
 * The grip step is what keeps the run going once the pivot has arrived —
 * `specs/rigging.md`: "Turning the grip applies no force to anything", and it
 * moves neither the pivot nor the cable length.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "slew", target: 40, rate: SLEW_MAX_RATE },
      { axis: "trolley", target: 3, rate: TROLLEY_MAX_RATE },
    ],
  },
  { kind: "move", commands: [{ axis: "grip", target: 60, rate: 5 }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Run the tape over one crane on an emptied yard, sampling the swing. */
async function swing(harness: Harness, crane: CraneDesign): Promise<string[]> {
  await openSite(harness, SITE);
  await clearAll(harness);
  await poseCrane(harness, crane);
  await poseTape(harness, TAPE);
  await startRun(harness);

  const path: string[] = [];
  for (let tick = 0; tick < SAMPLES; tick += 1) {
    const { run } = await runTicks(harness, 1);
    path.push(JSON.stringify({ bob: run.bob, axes: run.axes }));
  }
  return path;
}

it("swings the same way on two differently built cranes carrying one pivot path", async () => {
  const minimal = await swing(h, MINIMAL_CRANE);
  await h.capture("swing", "The bare hook swung out on the minimal crane");

  const second = await createHarness();
  let braced: string[];
  try {
    braced = await swing(second, OTHER_CRANE);
  } finally {
    await second.dispose();
  }

  for (const [index, sample] of minimal.entries()) {
    assertEqual(
      sample,
      braced[index],
      `the bob and the axes at tick ${index + 1}, against the same tape over ` +
        "a crane braced and weighted differently but carrying the pivot along " +
        "the same path: the rigging reads nothing but the pivot, the hoist " +
        "length and its own state (specs/rigging.md)",
    );
  }
});
