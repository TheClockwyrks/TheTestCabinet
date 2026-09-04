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
// squarely across the ring of space that leg would sweep if it turned with the arm.
// The tape then turns the arm.
//
// THE TURN IS TWENTY DEGREES AND THE BOX IS PLACED AGAINST IT, rather than a full
// circle with the box anywhere on the ring. The two are the same reading. The leg
// at `(2, y, 0)` stands `sqrt(2)` from the slew axis at `(1, ., 1)`, on the bearing
// `-45` degrees around it, and specs/statics.md fixes which way a turn carries it —
// "a positive `theta` turns `+x` toward `+z`" — so a turning leg walks that bearing
// upward, through `-38.9` degrees where it enters the box, and is still well inside
// the box at the `-25` degrees the tape parks it at. The run therefore drives the
// whole of the leg's entry tick by tick and ENDS with the arm standing at an angle
// that would have a tower leg buried in the obstacle. Turning a further
// seventeen-eighteenths of a circle adds no angle at which the leg is anywhere near
// the box; it only adds ticks, and ticks belonging to no requirement are ticks that
// can fail for a reason this point is not about.
//
// THE CONTROL IS THE SAME BOX, RAISED TO THE ARM, and it is what makes the reading
// above mean anything. The mast `(2, 6, 0)`–`(2, 10, 0)` stands on exactly the
// footprint the tower's leg does — `x = 2`, `z = 0`, `sqrt(2)` from the slew axis
// on the bearing `-45` — so a box with the same `x` and `z` spanning `y` 6.5 to 8.5
// instead of 1 to 3 occupies the very ring of space the first box occupies,
// differing only in whether the members that sweep it belong to the tower or to the
// arm. It stands clear of every member at slew `0` and the run ends on it as
// `structure-struck-obstacle` three degrees into the turn. So that ring of space IS
// swept, the tick-by-tick sweep test IS live over it, and the first reading is the
// tower standing still rather than a box lying somewhere nothing ever goes.
//
// The crane is posed once and only the box changes between the two runs, because
// the crane is not what differs between them.

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
  runTicks,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/**
 * The footprint both boxes stand on: clear of the tower's leg at `(2, y, 0)` and
 * across the ring of space that leg would sweep, placed against the near end of
 * that sweep.
 *
 * The leg stands at `sqrt(2)` from the slew axis at `(1, ., 1)`, on the bearing
 * `-45` degrees. This footprint spans `x` 2.10 to 2.95 and `z` 0.1 to 0.9, and the
 * circle of radius `sqrt(2)` about the axis runs through its inside between the
 * bearings `-38.9` and `-4.1`: a member on the leg's footprint that turned would
 * pass through the box's inside from `6.1` degrees of slew onward, which
 * specs/world.md is what a collision is. It clears the leg's standing plane
 * `x = 2` by 0.10, and the tower's two braces that run along `z = 0` — the leg's
 * own bearing — by the same.
 */
const PATH_MIN_XZ = { x: 2.1, z: 0.1 } as const;
const PATH_SIZE_XZ = { x: 0.85, z: 0.8 } as const;

/**
 * The box at the tower's height: `y` 1 to 3, inside the leg's own span of `y` 0 to
 * 4 and below every arm member of this crane, all of which stand at `y = 6` and
 * above and so pass over it untouched whatever the angle.
 */
const TOWER_PATH_MIN: Vec3 = { ...PATH_MIN_XZ, y: 1 };
const TOWER_PATH_SIZE: Vec3 = { ...PATH_SIZE_XZ, y: 2 };

/**
 * The same box at the arm's height: `y` 6.5 to 8.5, inside the mast's span of `y` 6
 * to 10 and above every tower member, all of which stand at `y = 4` and below. The
 * arm members standing nearest it at slew `0` are the mast itself, in the plane
 * `x = 2`, and the two mast cables, in the plane `z = 0`; both clear it by 0.10.
 */
const ARM_PATH_MIN: Vec3 = { ...PATH_MIN_XZ, y: 6.5 };
const ARM_PATH_SIZE: Vec3 = { ...PATH_SIZE_XZ, y: 2 };

/**
 * The turn: past the `6.1` degrees at which a turning tower leg would enter its
 * box, far enough to leave it buried there at the end, and past the `3.2` at which
 * the arm reaches the same box raised to its own height.
 */
const TURN = 20;

/**
 * The ticks the turn itself takes, driven in one call because nothing on the way
 * is read.
 *
 * Twenty degrees never reaches `SLEW_MAX_RATE`: under `SLEW_ACCEL` the controller
 * ramps up over ten degrees and brakes straight back down over ten,
 * `2 * sqrt(2 * 10 / 30)` — about `1.63` seconds of run clock (specs/program.md,
 * "The axes"). Driving past the end of a run reads nothing and decides nothing, so
 * this is a ceiling rather than a count the check depends on: the run's own end is
 * caught a tick at a time by the sweep that follows.
 */
const TURN_TICKS = 100;

/**
 * The blind ticks of the run that is meant to end early: short of the `3.2` degrees
 * at which the arm reaches the raised box, so the strike itself is caught a tick at
 * a time by the sweep rather than driven past.
 */
const STRIKE_TICKS = 20;

/** The tail swept a tick at a time, which is where a run's own end is read. */
const TAIL = 120;

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
 * What this point needs of it is narrower: a tower member and an arm member
 * standing on one footprint, which the leg `(2, 0, 0)`–`(2, 4, 0)` and the mast
 * `(2, 6, 0)`–`(2, 10, 0)` are.
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
  {
    kind: "move",
    commands: [{ axis: "slew", target: TURN, rate: SLEW_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("never sweeps a tower member into a box the arm's own members sweep into", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, JIB_RIG);
  await poseTape(h, TAPE);

  /** Turn the arm over one box, and answer the state its run ended in. */
  const turnOver = async (
    min: Vec3,
    size: Vec3,
    blind: number,
  ): Promise<GantrySnapshot> => {
    await h.debug.abortRun();
    // A cleared run leaves the results screen showing, and specs/program.md starts
    // a run "from the build or program screen"; the harness's poses each put the
    // screen back where they found it, so the check moves it itself.
    await h.debug.setScreen("build");
    await addOneObstacle(h, min, size);
    await startRun(h);
    await runTicks(h, blind);
    return runUntil(
      h,
      (s) => s.run.phase !== "running",
      TAIL,
      "the run to end, one way or the other",
    );
  };

  const overTheTower = await turnOver(
    TOWER_PATH_MIN,
    TOWER_PATH_SIZE,
    TURN_TICKS,
  );
  assertEqual(
    overTheTower.run.cause,
    null,
    "the cause a turn carries with a box across the ring of space a tower " +
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
    "The arm turned with a box across the tower's would-be sweep",
  );

  // The same box raised to the arm's height does end the run, so that ring of
  // space really is swept and really is tested tick by tick.
  const acrossTheArm = await turnOver(
    ARM_PATH_MIN,
    ARM_PATH_SIZE,
    STRIKE_TICKS,
  );
  assertEqual(
    acrossTheArm.run.cause,
    "structure-struck-obstacle",
    "the cause the same turn carries with the same box raised from the tower's " +
      "height to the arm's, which is what says the sweep test was live over " +
      "that ring of space for the reading above",
  );
});
