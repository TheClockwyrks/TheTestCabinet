// tape/reported-acceleration-braking — a braking tick reports `-s * a` as the
// axis's acceleration for that tick.
//
// specs/program.md § Axis motion: "a braking tick reports `-s * a`", and that
// figure is "the figure the inertial loads in `specs/statics.md` read" — the
// `alpha` of the tangential term `-alpha * (k x r)` an arm node is accelerated
// by. Braking toward a target above the axis has `s` of `+1`, so the tick's
// reported acceleration is `-SLEW_ACCEL`: the arm's tangential inertial load
// reverses while the arm is still turning forward.
//
// THE BRAKING TICK IS POSED UP TO ITS EDGE AND THEN EARNED. The move is
// `TARGET` degrees at the slew's max rate; the run's first tick takes the step
// and issues the command, and the axis is then given a rate through the surface
// — `setAxisRate` "poses a precondition like every other pose rather than an
// outcome ... Posing a rate onto an axis that is under a command sets what that
// axis is doing as the controller next reads it" (specs/instrumentation.md). At
// `BRAKE_FROM` degrees a second the axis needs `BRAKE_FROM^2 / (2 *
// SLEW_ACCEL)` degrees to stop, which is more than the `TARGET` still to go, so
// the very next tick lands in the brake branch. Nothing about the branch is
// posed: the build decides `v * s > 0`, decides `|d| <= v * v / (2 * a)`, and
// computes the acceleration the tick's inertial loads carry. The rate the
// reading is taken at is the rate the axis would have reached anyway — a
// ten-degree move peaks near it — so the arithmetic below reads the same
// magnitudes it always did, and the ramp up to it, which belongs to another
// point, is no longer in front of this one.
//
// THE BRAKING TICK IS CONFIRMED FROM THE AXIS ITSELF, not assumed: the reading
// is taken only where the rate fell while the command was still live, which is
// what the brake branch does (`v = v - s * a * dt`), and arrival is excluded
// because it sets the rate to `0` whatever the tick did on the way in.
//
// The figure is read back out of the tick's own member forces at the rail tip,
// where the node equilibrium specs/statics.md solves makes it recoverable
// exactly; a build reporting `0` or `+SLEW_ACCEL` lands `30` away from what
// this asserts.
//
// The yard is emptied so nothing hangs on the hook, and the minimal crane is the
// crane the NODE comment describes.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertNear, fail } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  RAIL_MASS_PER_UNIT,
  SLEW_ACCEL,
  SLEW_MAX_RATE,
  STRUT_MASS_PER_UNIT,
} from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type MaterialName,
  type Vec3,
} from "../harness";

/**
 * The node the tick's acceleration is read at: the minimal crane's rail tip.
 *
 * WHY THIS NODE. specs/statics.md § The load model gives the force a lumped mass
 * applies at its node, `F = m * g - m * a`, and an arm node's acceleration
 * `a = -omega^2 * r - alpha * (k x r)`. Nothing else is applied at `(4, 4, 0)`:
 * the trolley stands at the track origin `(0, 4, 0)` for the whole of these runs,
 * so neither its mass nor the cable force reaches this node ("shared between the
 * two nodes of the rail member the trolley is on, linearly by its position along
 * that member"), no counterweight sits on it, and it is not a flange node. Its
 * applied force is therefore its own lumped mass under its own acceleration,
 * exactly.
 */
const NODE = { x: 4, y: 4, z: 0 } as const;

/**
 * The slew axis: "the vertical line through the flange square's center",
 * `(x + LATTICE_PITCH / 2, y, z + LATTICE_PITCH / 2)` for a ring whose base
 * corner is the minimal crane's `(0, 2, 0)` (specs/structure.md).
 */
const AXIS = { x: 1, z: 1 } as const;

/** Each material's mass per unit (specs/structure.md). */
const MASS_PER_UNIT: Readonly<Record<MaterialName, number>> = {
  strut: STRUT_MASS_PER_UNIT,
  cable: CABLE_MASS_PER_UNIT,
  rail: RAIL_MASS_PER_UNIT,
};

const DEG = Math.PI / 180;

/**
 * The slew acceleration the tick's own solve carried, in degrees per second
 * squared, read back out of the member forces the tick reports.
 *
 * THE ARITHMETIC IS THE SPECIFICATION'S, RUN BACKWARDS. specs/statics.md solves
 * `K u = F`, whose row for a free node IS that node's equilibrium: the member
 * forces pulling on the node sum to minus the force applied there. So the applied
 * force at {@link NODE} is read off the tick's own force readout,
 *
 *     F = -sum over the members at the node of N_i * n_i
 *
 * with `n_i` the unit vector from the node toward the member's other end at this
 * tick's geometry (§ Geometry at a tick), and `N_i` positive in tension. The
 * specification then gives that same force as
 *
 *     F = m * g + m * omega^2 * r + m * alpha * (k x r)
 *
 * with `m` the node's lumped mass — half of every intact member ending there —
 * `r` the horizontal vector from the slew axis to the node, `k x r` the vector
 * `(r.z, 0, -r.x)`, and `omega` the tick's slew rate. Everything in it but
 * `alpha` is known, and only the tangential term `k x r` has a component along
 * the tangent, so projecting the leftover onto the tangent and dividing by
 * `m * |r|` gives the `alpha` the tick's inertial loads were built from.
 *
 * That is the figure specs/program.md fixes as "the axis's acceleration for the
 * tick, the figure the inertial loads in `specs/statics.md` read", and reading it
 * this way asks the build for nothing it is not already required to report.
 */
function reportedSlewAccel(snapshot: GantrySnapshot): number {
  const { structure, run } = snapshot;
  const theta = run.axes.slew.value * DEG;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const spin = (p: Vec3): Vec3 => ({
    x: AXIS.x + (p.x - AXIS.x) * cos - (p.z - AXIS.z) * sin,
    y: p.y,
    z: AXIS.z + (p.x - AXIS.x) * sin + (p.z - AXIS.z) * cos,
  });
  const isNode = (p: Vec3): boolean =>
    p.x === NODE.x && p.y === NODE.y && p.z === NODE.z;

  const forces = new Map(run.forces.map((one) => [one.id, one.force]));
  const at = spin({ x: NODE.x, y: NODE.y, z: NODE.z });
  let mass = 0;
  const pull = { x: 0, y: 0, z: 0 };
  let found = 0;
  for (const member of structure.members) {
    const here = isNode(member.a)
      ? member.a
      : isNode(member.b)
        ? member.b
        : null;
    if (here === null) continue;
    found += 1;
    const force = forces.get(member.id);
    if (force === undefined) {
      fail(
        `every member ending at (${NODE.x}, ${NODE.y}, ${NODE.z}) to carry a ` +
          "force in the tick's readout (specs/state.md)",
        `member ${member.id} carries none`,
      );
    }
    const far = spin(here === member.a ? member.b : member.a);
    const length = distance3(member.a, member.b);
    mass += (length * MASS_PER_UNIT[member.material]) / 2;
    pull.x += (force * (far.x - at.x)) / length;
    pull.y += (force * (far.y - at.y)) / length;
    pull.z += (force * (far.z - at.z)) / length;
  }
  if (found !== MEMBERS_AT_NODE) {
    fail(
      `the ${MEMBERS_AT_NODE} members the posed crane ends at ` +
        `(${NODE.x}, ${NODE.y}, ${NODE.z})`,
      `${found} stand there`,
    );
  }

  const r = { x: at.x - AXIS.x, z: at.z - AXIS.z };
  const radius = Math.hypot(r.x, r.z);
  const omega = run.axes.slew.rate * DEG;
  // What is left of the applied force once gravity (which has no horizontal
  // part) and the centripetal term are taken off it.
  const leftX = -pull.x - mass * omega * omega * r.x;
  const leftZ = -pull.z - mass * omega * omega * r.z;
  // Projected onto the tangent, `(k x r) / |r|`, and divided by `m * |r|`.
  const alpha =
    (leftX * (r.z / radius) + leftZ * (-r.x / radius)) / (mass * radius);
  return alpha / DEG;
}

/** The minimal crane's members ending at the rail tip: the rail and three ties. */
const MEMBERS_AT_NODE = 4;

/**
 * How far the recovered figure may sit from the one the specification names.
 *
 * The recovery is exact arithmetic over figures the specification fixes, so what
 * this allows for is a build's own floating point and nothing else — while the
 * three readings the rule distinguishes, `+SLEW_ACCEL`, `0` and `-SLEW_ACCEL`,
 * stand `30` apart.
 */
const TOLERANCE = 0.1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Short enough that a posed rate leaves the axis with no room to stop in. */
const TARGET = 2;

/**
 * The rate the axis is posed at, one tick into its move.
 *
 * `BRAKE_FROM^2 / (2 * SLEW_ACCEL)` is `2.4` degrees of stopping distance
 * against the `2` still to go, so the controller has to brake; and it is about
 * the rate a short move under `SLEW_ACCEL` peaks at anyway, so the centripetal
 * term the recovery below divides out is the size it always was.
 */
const BRAKE_FROM = 12;

it("builds the tick's inertial loads from -SLEW_ACCEL on a braking tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
    },
  ]);
  await startRun(h);

  // The run's first tick takes the step and issues its command to the axis.
  const commanded = await runTicks(h, 1);
  if (commanded.run.axes.slew.command === null) {
    fail(
      "the run's first tick to take the tape's move step and issue its slew " +
        "command (specs/program.md)",
      "the axis carries no command",
    );
  }

  // A braking tick: the rate fell, and the command is still live, so this is
  // not the arrival tick that sets the rate to 0.
  await h.debug.setAxisRate("slew", BRAKE_FROM);
  const braking: GantrySnapshot = await runTicks(h, 1);
  const now = braking.run.axes.slew;
  await h.capture("state", "The arm on a braking tick of a slew move");

  if (now.command === null || !(now.rate < BRAKE_FROM - 1e-12)) {
    fail(
      `the tick after the slew was posed at ${BRAKE_FROM} degrees a second, ` +
        `with ${TARGET} degrees to go, to brake under a live command: ` +
        "|d| <= v * v / (2 * a) holds (specs/program.md)",
      `the axis reports rate ${now.rate} and ` +
        `${now.command === null ? "no command" : "a live command"}`,
    );
  }

  const tick = braking;
  assertGreaterThan(
    tick.run.axes.slew.rate,
    0,
    "the slew's rate on the braking tick, still turning toward its target, so " +
      "s is +1 and the reported acceleration is -SLEW_ACCEL " +
      "(specs/program.md)",
  );
  assertNear(
    reportedSlewAccel(tick),
    -SLEW_ACCEL,
    TOLERANCE,
    "the slew acceleration the braking tick's member forces were built from, " +
      "which is -s * a with s of +1 (specs/program.md, specs/statics.md)",
  );
});
