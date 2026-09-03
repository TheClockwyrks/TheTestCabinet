// collisions/collision-fails-on-the-tick-the-body-stands-inside — the run ends on
// the first tick whose geometry stands a member inside the obstacle, and on no
// other.
//
// `specs/statics.md` § Collisions opens with the timing: "Collisions are tested
// ONCE PER TICK, AT THE PRESCRIBED GEOMETRY", and "Members standing clear at build
// time can sweep into an obstacle as the arm turns; THE TEST CATCHES THEM TICK BY
// TICK." `specs/program.md` § The tick pipeline puts that test at stage 5, after
// stage 2 has advanced the axes and stage 3 has taken the arm to its new angle, so
// the geometry the test reads is the one the tick just produced — and "a tick that
// ends the run counts like any other ... so the run clock the run ends on is that
// tick's own number over `TICK_HZ`."
//
// The requirement is therefore a coincidence of two clocks, and the check grades
// exactly that: a build that tested the geometry of the PREVIOUS tick ends the run
// one tick late, and a build that tested the geometry the axes are heading for
// ends it one tick early.
//
// HOW THE EXPECTED TICK IS FOUND. `specs/statics.md` § Geometry at a tick gives
// the arm's rotation in closed form — "`x' = ax + (x - ax) * cos(theta) - (z - az)
// * sin(theta)`", with the tower's nodes standing at their lattice positions — and
// `specs/world.md` gives the obstacle rule. So at every tick this check turns the
// crane's own members by the slew value THE RUN REPORTS, tests each segment
// against the box, and stops at the first tick that is either inside or ended.
// Every tick before that one was clear and the run was still going, because the
// sweep only continues while both hold; the tick it stops on has to be both.
//
// THE BOX IS SET WHERE THE ARM SWEEPS BRISKLY THROUGH IT — `x 3..3.4`, `y
// 3.5..4.5`, `z 1.6..2.4`, a block the rail crosses side on about a third of the
// way through a quarter turn, roughly a hundred ticks in. A crossing that grazed
// the box would put the entry inside a hair's breadth of a tick boundary; this one
// carries the arm a good fraction of a unit per tick through it, so the tick the
// geometry first stands inside is not in doubt.
//
// The yard holds that one obstacle and no load, so the bare hook is tested against
// the ground alone and hangs clear of it, and the tower — everything at `y <= 2` —
// stands outside the box on `y` however the arm turns.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { LATTICE_PITCH, SLEW_MAX_RATE } from "../constants";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The block `x 3..3.4`, `y 3.5..4.5`, `z 1.6..2.4`. */
const MIN: readonly [number, number, number] = [3, 3.5, 1.6];
const MAX: readonly [number, number, number] = [3.4, 4.5, 2.4];

/** A quarter turn of the arm at its maximum rate. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }] },
];

/** A quarter turn at `SLEW_MAX_RATE` is four seconds of run clock. */
const CAP = 300;

/** Below this a segment is parallel to a pair of faces and tested as a point. */
const PARALLEL = 1e-12;

type Point = readonly [number, number, number];

/**
 * Whether the segment reaches STRICTLY inside the box, as `specs/world.md` states
 * it: some point of it lying strictly between the box's minimum and its maximum on
 * all three axes. The slab clip keeps the open interval, so a segment lying in a
 * face plane or touching one at a point leaves no interior stretch and is clear.
 */
function reachesInside(p: Point, q: Point): boolean {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i += 1) {
    const d = (q[i] as number) - (p[i] as number);
    const from = p[i] as number;
    const low = MIN[i] as number;
    const high = MAX[i] as number;
    if (Math.abs(d) < PARALLEL) {
      if (from <= low || from >= high) return false;
    } else {
      const a = (low - from) / d;
      const b = (high - from) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 >= t1) return false;
    }
  }
  return true;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run on the first tick whose geometry stands a member inside the obstacle", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(
    h,
    { x: MIN[0], y: MIN[1], z: MIN[2] },
    { x: MAX[0] - MIN[0], y: MAX[1] - MIN[1], z: MAX[2] - MIN[2] },
  );
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const ring = started.structure.ring;
  assertTrue(ring !== null, "the slew ring the arm turns on (specs/structure.md)");

  // The slew axis is "the vertical line through the flange square's center", and
  // the top flange stands one lattice pitch above the ring's base corner
  // (`specs/structure.md`), which is what divides the arm from the tower here.
  const axisX = (ring?.corner.x ?? 0) + LATTICE_PITCH / 2;
  const axisZ = (ring?.corner.z ?? 0) + LATTICE_PITCH / 2;
  const topFlangeY = (ring?.corner.y ?? 0) + LATTICE_PITCH;

  const standsInside = (s: GantrySnapshot): boolean => {
    const theta = (s.run.axes.slew.value * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const place = (n: Vec3): Point => {
      if (n.y < topFlangeY) return [n.x, n.y, n.z];
      const dx = n.x - axisX;
      const dz = n.z - axisZ;
      return [axisX + dx * cos - dz * sin, n.y, axisZ + dx * sin + dz * cos];
    };
    return s.structure.members
      .filter((m) => !s.run.broken.includes(m.id))
      .some((m) => reachesInside(place(m.a), place(m.b)));
  };

  let ticks = 0;
  let stopped: GantrySnapshot | null = null;
  let inside = false;
  while (ticks < CAP) {
    const s = await runTicks(h, 1);
    ticks += 1;
    inside = standsInside(s);
    if (inside || s.run.phase !== "running") {
      stopped = s;
      break;
    }
  }

  await h.capture("first", "The first tick the member stands inside");

  assertTrue(
    stopped !== null,
    `the arm to sweep a member inside the box within ${CAP} ticks, so this ` +
      "scenario reaches the tick it is about",
  );
  assertLength(
    stopped?.run.broken ?? [],
    0,
    "the members broken during the sweep, so the geometry this check turned " +
      "is the geometry the run tested",
  );
  assertTrue(
    inside,
    "the run to still be going on every tick whose geometry leaves every " +
      "member clear of the box: it ended on tick " +
      `${stopped?.run.tick ?? -1}, at slew ` +
      `${stopped?.run.axes.slew.value ?? Number.NaN}, where no member reaches ` +
      "inside it (specs/world.md, specs/statics.md)",
  );
  assertEqual(
    stopped?.run.phase,
    "failed",
    "the run on the first tick whose geometry stands a member strictly inside " +
      "the box, at slew " +
      `${stopped?.run.axes.slew.value ?? Number.NaN}: collisions are tested ` +
      "once per tick, at the prescribed geometry (specs/statics.md)",
  );
  assertEqual(
    stopped?.run.cause,
    "structure-struck-obstacle",
    "the cause a member sweeping into an obstacle ends the run with",
  );
  assertEqual(
    stopped?.run.tick,
    ticks,
    "the tick the run ended on, counted from the ticks this check drove: the " +
      "failing tick counts like any other (specs/program.md)",
  );
});
