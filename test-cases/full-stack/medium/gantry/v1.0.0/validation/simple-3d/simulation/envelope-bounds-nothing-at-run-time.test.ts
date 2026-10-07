// simulation/envelope-bounds-nothing-at-run-time — the build envelope bounds where
// a crane may be built and nothing else.
//
// specs/world.md, "The envelope": "Every lattice node used by the structure lies
// inside the envelope, so the envelope bounds where the crane may be built. ... The
// envelope bounds nothing at run time: once the tape runs, the arm swings wherever
// its geometry takes it, envelope or not." specs/statics.md's closed vocabulary of
// failure causes carries nothing for an envelope either, and specs/program.md's
// axis table makes `slew` "unbounded".
//
// The crane is the reference design for the first site, stood up on the third — a
// site whose envelope runs only from `z = -8` to `z = 8`, while the crane's track
// reaches ten units along `+x` from a slew axis that stands at `z = 1`. The yard is
// emptied first, so the site's own wall is not in the way and nothing but the
// envelope is under test. The trolley is posed to the track's far end, which puts
// the pivot on the outermost node of the arm.
//
// THE ARM IS POSED TO JUST INSIDE THE WALL AND THEN DRIVEN THROUGH IT. Where the
// arm has already turned is a precondition, so the slew is posed there rather than
// driven from zero; what the reading is about is what happens as the pivot crosses
// `z = 8`, and that is left to the tape and to real ticks. The tape's slew step
// therefore starts AFTER the pose — the tape opens on a grip command to the grip's
// own starting value, which "is done on the tick it is issued" (specs/program.md) —
// so the drive that carries the arm out through the wall is the tape's own.
//
// Three things must hold across that crossing. The pivot starts inside the
// envelope, so the crossing is real rather than a reading taken somewhere the arm
// already stood. Past the wall the run is still running with no cause. And the slew
// goes on to the target the tape gave it rather than stopping at any envelope wall.
// Between them they say the envelope neither ends the run nor clamps the motion.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertTrue,
} from "../assert";
import {
  GRIP_MAX_RATE,
  HOIST_START,
  LATTICE_PITCH,
  SLEW_MAX_RATE,
} from "../constants";
import {
  DESIGNS,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type Harness,
  type TapeStepSpec,
  type Vec3,
} from "../harness";

/** The site the crane is stood on: its envelope is the narrowest in `z`. */
const SITE = 2;

/** The crane, whose track runs from `(0, 4, 0)` out to `(10, 4, 0)`. */
const DESIGN = DESIGNS[0]!;

/** The track's far end, and the lattice node the trolley stands on there. */
const TROLLEY = 10;
const NODE: Vec3 = { x: 10, y: 4, z: 0 };

/**
 * Where the arm is posed to, and where the tape then drives it.
 *
 * The pivot's height above the envelope's `z = 8` wall at slew `a` is
 * `1 + 9 sin a - cos a`: it reaches the wall a little short of `57` degrees. So
 * `55` stands inside and `59` stands out, and the tape's own drive is what carries
 * the arm across.
 */
const POSED = 55;
const TARGET = 59;

/**
 * The tape: a grip command to the grip's starting value, the slew that matters,
 * and a grip command that outlasts the reading.
 *
 * The first step exists so the slew step is not live when this check poses the
 * slew — a pose leaves an axis "stopped with no live command"
 * (specs/instrumentation.md), which would take the tape's own command away from
 * it. A move whose target is the axis's current value "does not move, and step 3
 * finds it arrived, so the command is done on the tick it is issued"
 * (specs/program.md), and the grip starts a run at `0`, so that step costs the one
 * tick and the slew step opens on the next.
 */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 0, rate: GRIP_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks driven between readings, and the ceiling on the whole drive. */
const STRIDE = 6;
const CAP = 300;

/**
 * The slew axis of a crane whose ring stands on `base`.
 *
 * specs/structure.md: the ring's flange square is the four nodes at `base` and one
 * lattice pitch along `x` and `z` from it, and "the slew axis is the vertical line
 * through the flange square's centre".
 */
function slewAxis(base: readonly [number, number, number]): {
  x: number;
  z: number;
} {
  return { x: base[0] + LATTICE_PITCH / 2, z: base[2] + LATTICE_PITCH / 2 };
}

/**
 * Where a node of the arm stands once the arm has turned `degrees`.
 *
 * The ring "turns the top flange about the slew axis by the slew angle and takes
 * the whole arm with it" (specs/structure.md), and a positive yaw "turns `+x`
 * toward `+z`" (specs/world.md).
 */
function turned(
  node: Vec3,
  base: readonly [number, number, number],
  degrees: number,
): Vec3 {
  const axis = slewAxis(base);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = node.x - axis.x;
  const dz = node.z - axis.z;
  return {
    x: axis.x + dx * cos - dz * sin,
    y: node.y,
    z: axis.z + dx * sin + dz * cos,
  };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("lets the arm swing outside the envelope without clamping it or ending the run", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, DESIGN);
  await poseTape(h, TAPE);

  const started = await startRun(h);
  const envelope = started.site.envelope;

  // The precondition: the trolley on the arm's outermost node, the arm already a
  // good part of the way round, and the bob straight back under where that leaves
  // the pivot so the pendulum takes no jolt from the jump. All of it before the
  // first tick, so the tape's slew step has not been issued yet and the pose does
  // not take its command away.
  const pivot = turned(NODE, DESIGN.ring!, POSED);
  await h.debug.setAxis("trolley", TROLLEY);
  await h.debug.setAxis("slew", POSED);
  await h.debug.setBob(pivot.x, pivot.y - HOIST_START, pivot.z);
  await h.debug.setBobVelocity(0, 0, 0);

  const inside = await runTicks(h, 1);
  assertNear(
    inside.run.axes.trolley.value,
    TROLLEY,
    1e-9,
    "the trolley standing at the track's far end, so the pivot is the arm's " +
      "outermost node",
  );
  assertTrue(
    inside.run.pivot.z <= envelope.max.z,
    `the arm's outermost node standing INSIDE the envelope's own z bound of ` +
      `${envelope.max.z} at slew ${POSED} degrees, so the crossing this reading ` +
      `is about is one the tape drives — it stands at z ` +
      `${inside.run.pivot.z.toFixed(3)}`,
  );

  // The tape's own drive carries the arm out through the wall.
  let swung = inside;
  for (let i = 0; i < CAP && swung.run.pivot.z <= envelope.max.z; i += STRIDE) {
    swung = await runTicks(h, STRIDE);
  }
  assertGreaterThan(
    swung.run.pivot.z,
    envelope.max.z,
    "the arm's outermost node standing past the envelope's own z bound of " +
      envelope.max.z +
      " once the tape has driven the slew out past it " +
      "(specs/world.md: the envelope bounds nothing at run time)",
  );
  assertEqual(
    swung.run.phase,
    "running",
    "the run still running with the arm outside the envelope",
  );
  assertEqual(
    swung.run.cause,
    null,
    "the cause a run carries while the arm stands outside the envelope",
  );

  // And the motion was never clamped: the slew reaches the target the tape gave.
  let arrived = swung;
  for (
    let i = 0;
    i < CAP &&
    !(
      arrived.run.axes.slew.rate === 0 &&
      Math.abs(arrived.run.axes.slew.value - TARGET) <= 1e-9
    );
    i += STRIDE
  ) {
    arrived = await runTicks(h, STRIDE);
  }
  await h.capture(
    "swung-out",
    "The arm standing outside the site's build envelope, mid-run",
  );

  assertNear(
    arrived.run.axes.slew.value,
    TARGET,
    1e-9,
    "the slew value the tape drove to, reached from outside the envelope " +
      "rather than stopped at its wall (phase " +
      arrived.run.phase +
      ", cause " +
      String(arrived.run.cause) +
      ")",
  );
  assertTrue(
    arrived.run.phase === "running" || arrived.run.phase === "cleared",
    "the run reaching the end of its slew rather than failing on the way " +
      "(phase " +
      arrived.run.phase +
      ", cause " +
      String(arrived.run.cause) +
      ")",
  );
});
