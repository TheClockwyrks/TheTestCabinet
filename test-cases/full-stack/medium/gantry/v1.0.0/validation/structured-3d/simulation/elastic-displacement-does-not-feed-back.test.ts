// simulation/elastic-displacement-does-not-feed-back — a loaded crane holding
// still does not creep.
//
// `specs/statics.md`, its opening: "The prescribed geometry is what moves: node
// positions come from the lattice, the slew rotation, and nothing else. Elastic
// displacements are a readout for drawing and never feed back into positions,
// velocities, or the next tick."
//
// The scenario is a crane carrying a heavy load and told to do nothing that moves
// it. The tape's only motion is the grip, and `specs/rigging.md` says of it
// "Turning the grip applies no force to anything" — so the slew stays at `0`, the
// trolley at the track origin, and the hoist at `HOIST_START`, while the run keeps
// ticking for a whole second of run clock.
//
// TWO THINGS ARE READ, and they are the two the specification names. The pivot is
// the prescribed trolley point: with the slew at `0` and the trolley at the
// origin, that is the track's origin node `(4, 4, 0)` and it must stay there
// EXACTLY, tick after tick. And the member forces, which are what an elastic
// displacement would move if it were fed back: the solve at tick sixty must
// answer what the solve at tick two answered, to the last bit. A build that let
// the solved displacements move its nodes reads a pivot that drifts, or forces
// that walk.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertClose,
  assertEqual,
  assertVec3Near,
  assertLength,
} from "../assert";
import { HOIST_START } from "../constants";
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
  name: "Loaded and still",
  ring: [0, 2, 0],
  counterweights: [],
  members: MEMBERS,
  tape: [],
};

/** The track's origin node, which the pivot stands at with the trolley at `0`. */
const ORIGIN = { x: 4, y: 4, z: 0 };

/** Where the hook hangs at the run-start posture: `HOIST_START` below the pivot. */
const HOOK = { x: ORIGIN.x, y: ORIGIN.y - HOIST_START, z: ORIGIN.z, yaw: 0 };

/** A load heavy enough that the crane is working, and light enough to hold. */
const LOAD_MASS = 60;

/** Attach the load, then turn the grip: the one motion that applies no force. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "action", action: "attach" },
  { kind: "move", commands: [{ axis: "grip", target: 3600, rate: 45 }] },
];

/** Ticks of run clock the crane is asked to hold still for. */
const HELD = 60;

/** How many of those are read one at a time before the rest are run in one go. */
const SAMPLED = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the pivot and every force where the lattice put them", async () => {
  await openSite(h, 5);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, TAPE);
  await startRun(h);

  // Tick one takes the `attach`; tick two is the first tick the bob's whole mass
  // is on the structure and nothing is moving, so it is the reading everything
  // after it is measured against.
  const settled = await runTicks(h, 2);
  assertEqual(settled.run.attached, 0, "the load the tape attached");
  assertLength(
    settled.run.forces.filter((one) => !Number.isFinite(one.force)),
    0,
    "members whose force came back finite",
  );

  // TICK BY TICK OVER THE FIRST STRETCH, then the rest of the second in one go.
  // A creep that fed elastic displacement back into the geometry moves the pivot
  // on every tick it happens, and a tolerance of `1e-9` against displacements of
  // order a thousandth of a unit catches it on the first of them — so the reading
  // that decides this point is the pivot at the end, and the ticks sampled one at
  // a time are there to say WHERE a build that moved started moving. The crane
  // still holds still for the whole second either way: what changed is how often
  // the ticks are looked at, not how many are run.
  for (let tick = 3; tick <= SAMPLED; tick += 1) {
    const now = await runTicks(h, 1);
    assertEqual(now.run.phase, "running", `the run's phase at tick ${tick}`);
    assertVec3Near(
      now.run.pivot,
      ORIGIN,
      1e-9,
      `the pivot at tick ${tick}: the prescribed trolley point, which the ` +
        "lattice and a slew of 0 put at the track's origin (specs/statics.md)",
    );
  }

  const held = await runTicks(h, HELD - SAMPLED);
  await h.capture(
    "elastic-displacement-does-not-feed-back",
    "the loaded crane after a second of holding still",
  );

  assertEqual(held.run.phase, "running", `the run's phase at tick ${HELD}`);
  assertVec3Near(
    held.run.pivot,
    ORIGIN,
    1e-9,
    `the pivot at tick ${HELD}: the prescribed trolley point, which the ` +
      "lattice and a slew of 0 put at the track's origin (specs/statics.md)",
  );
  assertEqual(held.run.tick, HELD, "the ticks the crane was held for");
  assertLength(
    held.run.forces,
    settled.run.forces.length,
    "the members reported at the end, against the members reported at tick 2",
  );
  for (const member of held.run.forces) {
    const before = settled.run.forces.find((one) => one.id === member.id);
    assertClose(
      member.force,
      before?.force ?? Number.NaN,
      1e-9,
      `member ${member.id}'s force at tick ${HELD} against its force at tick ` +
        "2: the geometry never moved, so the solve cannot have (specs/statics.md)",
    );
  }
});
