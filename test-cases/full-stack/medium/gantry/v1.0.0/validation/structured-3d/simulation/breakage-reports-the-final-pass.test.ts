// simulation/breakage-reports-the-final-pass — the forces reported after a
// breakage are the last pass's, over the members still intact.
//
// `specs/statics.md` § Utilization and breakage: "Both solves then run again at
// the same tick, over the members still intact, with the lumped masses and the
// applied forces recomputed for them". `specs/state.md` says what is then
// reported: `forces` is "The latest solve's, in member-id order, over the members
// still intact".
//
// A build that reported the pass that FOUND the breakage would carry the broken
// member in the list and would give every other member the force it had while the
// broken one was still helping. So the check compares the run against the only
// thing that can settle it: THE SAME CRANE WITH THAT MEMBER NEVER PLACED.
// `removeMember` takes it out without renumbering anything — "the next member id
// climbs with every member placed and falls only when the structure is emptied
// whole" (`specs/structure.md`) — so the reference crane's members carry exactly
// the ids the first run's do, and the two force readouts can be compared one for
// one.
//
// AND IT IS LITERALLY THE SAME CRANE. The first run is aborted rather than the
// site reopened: `abortRun` "poses the abort, ending a running run with no
// verdict: `run` goes back to its idle placeholder and the build screen returns"
// (`specs/instrumentation.md`), which leaves the structure, the tape and the
// site's loads exactly as they were and puts the screen back where a structure
// pose applies. So the stay is taken out of the crane that stood, the second run
// starts from the same load at the same pose, and the two runs differ in the one
// member this check is about — rather than in fifty-three separately posed edits
// that happen to describe the same thing.
//
// The recomputation is not a formality here: the stay that breaks was carrying
// most of the lifted load, so the cable stay beside it and the mast members behind
// it all move by hundreds of force units between the two passes.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertDeepEqual, assertLength } from "../assert";
import {
  addOneLoad,
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

/**
 * The reference crane these checks are posed on, built on site 6 (Heavy Haul) for
 * its nine ground anchors and its `6000` budget.
 *
 * Ids are the order the members are listed in, which is the order `poseCrane`
 * places them and therefore the id each one carries in every force readout and
 * every `broken` entry (`specs/instrumentation.md`).
 *
 *   - `0`-`21`  the tower: a leg under each of the ring's four bottom-flange
 *               nodes, the flange square with both its horizontal diagonals, and
 *               inclined braces from every anchor the site gives, so no tower
 *               member is ever the weakest thing in the crane.
 *   - `22`-`30` the mast: two heads at `(0, 6, 0)` and `(0, 6, 2)`, each tied to
 *               all four top-flange nodes, and tied to each other.
 *   - `31`-`44` the jib: two chords out to `x = 8` at `z = 0` and `z = 2`, the
 *               rail among them, and the cross members that make the pair rigid.
 *   - `45`-`52` the stays: at `(4, 4, 0)` and `(4, 4, 2)` a stiff STRUT stay and
 *               a CABLE stay side by side, and four cables out to the jib tip.
 *
 * The trolley's track is the single rail `32`, from `(4, 4, 0)` to `(8, 4, 0)`.
 * Its origin is the end nearer the slew axis, `(4, 4, 0)`, so a run starts with
 * the trolley — and anything hanging from it — at that node.
 */
const MEMBERS: CraneDesign["members"] = [
  /*  0 */ [[0, 0, 0], [0, 2, 0], "strut"],
  /*  1 */ [[2, 0, 0], [2, 2, 0], "strut"],
  /*  2 */ [[0, 0, 2], [0, 2, 2], "strut"],
  /*  3 */ [[2, 0, 2], [2, 2, 2], "strut"],
  /*  4 */ [[0, 2, 0], [2, 2, 0], "strut"],
  /*  5 */ [[0, 2, 2], [2, 2, 2], "strut"],
  /*  6 */ [[0, 2, 0], [0, 2, 2], "strut"],
  /*  7 */ [[2, 2, 0], [2, 2, 2], "strut"],
  /*  8 */ [[0, 2, 0], [2, 2, 2], "strut"],
  /*  9 */ [[2, 2, 0], [0, 2, 2], "strut"],
  /* 10 */ [[2, 0, 0], [0, 2, 0], "strut"],
  /* 11 */ [[0, 0, 2], [0, 2, 0], "strut"],
  /* 12 */ [[0, 0, 0], [2, 2, 0], "strut"],
  /* 13 */ [[2, 0, 2], [2, 2, 0], "strut"],
  /* 14 */ [[4, 0, 0], [2, 2, 0], "strut"],
  /* 15 */ [[4, 0, 2], [2, 2, 2], "strut"],
  /* 16 */ [[0, 0, 4], [0, 2, 2], "strut"],
  /* 17 */ [[2, 0, 4], [2, 2, 2], "strut"],
  /* 18 */ [[4, 0, 4], [2, 2, 2], "strut"],
  /* 19 */ [[4, 0, 0], [2, 2, 2], "strut"],
  /* 20 */ [[0, 0, 4], [2, 2, 2], "strut"],
  /* 21 */ [[4, 0, 2], [2, 2, 0], "strut"],
  /* 22 */ [[0, 4, 0], [0, 6, 0], "strut"],
  /* 23 */ [[2, 4, 0], [0, 6, 0], "strut"],
  /* 24 */ [[0, 4, 2], [0, 6, 0], "strut"],
  /* 25 */ [[2, 4, 2], [0, 6, 0], "strut"],
  /* 26 */ [[0, 4, 2], [0, 6, 2], "strut"],
  /* 27 */ [[2, 4, 2], [0, 6, 2], "strut"],
  /* 28 */ [[0, 4, 0], [0, 6, 2], "strut"],
  /* 29 */ [[2, 4, 0], [0, 6, 2], "strut"],
  /* 30 */ [[0, 6, 0], [0, 6, 2], "strut"],
  /* 31 */ [[0, 4, 0], [4, 4, 0], "strut"],
  /* 32 */ [[4, 4, 0], [8, 4, 0], "rail"],
  /* 33 */ [[0, 4, 2], [4, 4, 2], "strut"],
  /* 34 */ [[4, 4, 2], [8, 4, 2], "strut"],
  /* 35 */ [[0, 4, 0], [0, 4, 2], "strut"],
  /* 36 */ [[4, 4, 0], [4, 4, 2], "strut"],
  /* 37 */ [[8, 4, 0], [8, 4, 2], "strut"],
  /* 38 */ [[0, 4, 0], [4, 4, 2], "strut"],
  /* 39 */ [[4, 4, 2], [8, 4, 0], "strut"],
  /* 40 */ [[2, 4, 0], [4, 4, 0], "strut"],
  /* 41 */ [[2, 4, 2], [4, 4, 0], "strut"],
  /* 42 */ [[0, 4, 2], [4, 4, 0], "strut"],
  /* 43 */ [[2, 4, 0], [4, 4, 2], "strut"],
  /* 44 */ [[2, 4, 2], [4, 4, 2], "strut"],
  /* 45 */ [[0, 6, 0], [4, 4, 0], "strut"],
  /* 46 */ [[0, 6, 2], [4, 4, 0], "cable"],
  /* 47 */ [[0, 6, 2], [4, 4, 2], "strut"],
  /* 48 */ [[0, 6, 0], [4, 4, 2], "cable"],
  /* 49 */ [[0, 6, 0], [8, 4, 0], "cable"],
  /* 50 */ [[0, 6, 2], [8, 4, 2], "cable"],
  /* 51 */ [[0, 6, 2], [8, 4, 0], "cable"],
  /* 52 */ [[0, 6, 0], [8, 4, 2], "cable"],
];

const CRANE: CraneDesign = {
  site: 6,
  name: "Reported after a break",
  ring: [0, 2, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

/**
 * The load the tape lifts, posed right under the hook.
 *
 * A run starts with the trolley at the track's origin, `(4, 4, 0)`, and the bob
 * "hangs at rest directly below the pivot" at `HOIST_START` below it
 * (`specs/rigging.md`), so a load whose lift point is `(4, 2, 0)` is under the
 * hook and inside `ATTACH_RADIUS` of it.
 */
const HOOK = { x: 4, y: 2, z: 0, yaw: 0 };

const LOAD_MASS = 106;

/** The stay that breaks. */
const STAY = 45;

const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 45 }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reports the surviving members with the forces of the pass that kept them", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);
  const broke = await runTicks(h, 1);
  await h.capture(
    "breakage-reports-the-final-pass",
    "the crane on the tick its stay broke",
  );
  assertDeepEqual(broke.run.broken, [STAY], "the members that broke");

  // The same crane, the same load, the same tape — with that member taken out
  // before the run rather than during it. Its ids are unchanged, so what this
  // run solves at tick one IS the pass the first run finished on.
  await h.debug.abortRun();
  await h.debug.removeMember(STAY);
  await startRun(h);
  const reference = await runTicks(h, 1);
  assertLength(
    reference.run.broken,
    0,
    "the members the reference crane breaks: none, so its first pass is its " +
      "last and its forces are a final pass's",
  );

  assertDeepEqual(
    broke.run.forces.map((one) => one.id),
    reference.run.forces.map((one) => one.id),
    "the members reported after the breakage: exactly the ones still intact",
  );
  for (const member of broke.run.forces) {
    const same = reference.run.forces.find((one) => one.id === member.id);
    assertClose(
      member.force,
      same?.force ?? Number.NaN,
      1e-6,
      `member ${member.id}'s reported force after the breaking tick, against ` +
        "the same crane solved without the broken member: the last pass's " +
        "figures, not the first's (specs/statics.md)",
    );
  }
});
