// simulation/tower-nodes-stand-still — the ring turns the arm and the tower stands
// where it was built.
//
// specs/statics.md, "Geometry at a tick": "Tower nodes stand at their lattice
// positions. Arm nodes turn with the slew angle". specs/structure.md says the same
// of the ring: it "turns the top flange about the slew axis by the slew angle and
// takes the whole arm with it, so an arm node stands at its lattice position turned
// by that angle and nothing else moves it, while the bottom flange stands still."
// So no slew angle moves a tower member in the world, and a tower member cannot
// sweep into anything.
//
// The scenario is a collision, because that is what a moving member would do that a
// still one cannot. specs/statics.md: "A member whose segment reaches inside an
// obstacle ends the run as `structure-struck-obstacle`. Members standing clear at
// build time can sweep into an obstacle as the arm turns; the test catches them tick
// by tick." A box is posed just clear of the tower's own leg at `(2, y, 0)` and
// squarely across the ring of space that leg would sweep if it turned with the arm:
// every point of the box lies below `y = 3`, so the jib, its mast and its cables —
// all of which stand at `y = 6` and above — pass over it untouched whatever the
// angle. The tape then turns the arm a full circle.
//
// The second half of the check is what makes the first half mean anything. The same
// box moved into the jib's own swept path does end the run as
// `structure-struck-obstacle`, so the crane really is being tested against
// obstacles and a passing first half is the tower standing still rather than the
// collision test being asleep.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  addOneObstacle,
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

/**
 * A box standing clear of the tower and across the ring the tower's leg at
 * `(2, y, 0)` would sweep.
 *
 * That leg stands at `sqrt(2)` from the slew axis at `(1, ., 1)`. The box spans
 * `x` 2.2 to 3 and `z` 0.5 to 1.5, so the point `(2.414, y, 1)` is strictly inside
 * it and exactly `sqrt(2)` from the axis: a leg that turned would pass through the
 * box's inside, which specs/world.md is what a collision is. It spans `y` 1 to 3,
 * below every arm member of this crane.
 */
const TOWER_PATH_MIN: Vec3 = { x: 2.2, y: 1, z: 0.5 };
const TOWER_PATH_SIZE: Vec3 = { x: 0.8, y: 2, z: 1 };

/**
 * The same box moved into the jib's own swept path.
 *
 * The jib's outer rail runs from `(4, 6, 0)` to `(6, 6, 0)`, between `3.16` and
 * `5.10` from the slew axis, and the point `(4, 6, 4)` is `4.24` from it — inside
 * the box and on the rail's own sweep.
 */
const JIB_PATH_MIN: Vec3 = { x: 3.5, y: 5.5, z: 3.5 };
const JIB_PATH_SIZE: Vec3 = { x: 1, y: 1, z: 1 };

/** A full turn of the arm. */
const TURN = 360;

/**
 * The jib rig, and why it is shaped this way.
 *
 * The tower is the box between the site's four ground anchors and the slew ring's
 * bottom flange at `y = 4`: a vertical leg under each bottom-flange node, the four
 * flange horizontals with one diagonal across them, and three inclined anchor
 * braces — the bracing a cube on a fixed base needs so the tower solve is not a
 * mechanism (specs/statics.md, "Singularity"). The two braces are placed so the
 * corners `(0, 4, 0)` and `(0, 4, 2)` carry their vertical leg and horizontal
 * members alone: at such a corner the leg is the only member with a vertical
 * component, so vertical equilibrium there fixes the leg's force at exactly minus
 * the whole vertical load applied at the node, whatever the rest of the tower does.
 *
 * The arm is a mast head at `(2, 10, 0)` braced back to three top-flange nodes, a
 * two-rail track running out along `+x` from the top-flange node `(2, 6, 0)`, each
 * outboard rail node hung from the mast head by one cable and braced sideways by
 * one horizontal strut back to `(2, 6, 2)`. At `(4, 6, 0)` and `(6, 6, 0)` that
 * mast cable is the only member with a vertical component and that sideways brace
 * the only member with a `z` component, so each of those two equilibria is a
 * single-member reading as well.
 *
 * Every node lies inside site 1's envelope and the crane costs `1066.40` against a
 * budget of `3000`.
 */
const JIB_RIG_MEMBERS: readonly DesignMember[] = [
  // The tower: four legs, the flange square with one diagonal, three braces.
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 2], "strut"],
  [[0, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [2, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 0], "strut"],
  // The arm: the mast head and its braces.
  [[2, 6, 0], [2, 10, 0], "strut"],
  [[2, 10, 0], [2, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 2], "strut"],
  [[2, 10, 0], [0, 6, 0], "strut"],
  // The arm: the track, its mast cables, and its sideways braces.
  [[2, 6, 0], [4, 6, 0], "rail"],
  [[4, 6, 0], [6, 6, 0], "rail"],
  [[2, 10, 0], [4, 6, 0], "cable"],
  [[2, 10, 0], [6, 6, 0], "cable"],
  [[4, 6, 0], [2, 6, 2], "strut"],
  [[6, 6, 0], [2, 6, 2], "strut"],
];

const JIB_RIG: CraneDesign = {
  site: 1,
  name: "Jib rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: JIB_RIG_MEMBERS,
  tape: [],
};

const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: TURN, rate: SLEW_MAX_RATE }] },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never sweeps a tower member into an obstacle, however far the arm turns", async () => {
  await openSite(h, 0);

  /** Stand the crane over one box and turn the arm a full circle. */
  const turnOver = async (min: Vec3, size: Vec3) => {
    await h.debug.abortRun();
    // A cleared run leaves the results screen showing, and specs/program.md starts
    // a run "from the build or program screen"; the harness's poses each put the
    // screen back where they found it, so the check moves it itself.
    await h.debug.setScreen("build");
    await clearAll(h);
    await poseCrane(h, JIB_RIG);
    await addOneObstacle(h, min, size);
    await poseTape(h, TAPE);
    await startRun(h);
    return runUntil(
      h,
      (s) => s.run.phase !== "running",
      1600,
      "the run to end, one way or the other",
    );
  };

  const overTheTower = await turnOver(TOWER_PATH_MIN, TOWER_PATH_SIZE);
  assertEqual(
    overTheTower.run.cause,
    null,
    "the cause a full turn carries with a box across the ring of space a tower " +
      "member would sweep: none, because the tower stands at its lattice " +
      "positions whatever the slew (specs/statics.md, specs/structure.md)",
  );
  assertEqual(
    overTheTower.run.phase,
    "cleared",
    "the run ending as its tape does rather than on the box",
  );

  await h.capture(
    "tower-clears-the-box",
    "The arm turned round with a box across the tower's would-be sweep",
  );

  // The box moved into the jib's own path does end the run, so the crane really
  // is being tested against this obstacle.
  const acrossTheJib = await turnOver(JIB_PATH_MIN, JIB_PATH_SIZE);
  assertEqual(
    acrossTheJib.run.cause,
    "structure-struck-obstacle",
    "the cause the same turn carries with the box in the jib's own swept path, " +
      "which is what says the collision test was live for the reading above",
  );
});
