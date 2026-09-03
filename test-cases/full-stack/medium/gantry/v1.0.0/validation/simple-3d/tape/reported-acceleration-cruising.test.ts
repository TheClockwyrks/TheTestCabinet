// tape/reported-acceleration-cruising — a cruising tick reports `0`, so its
// inertial load carries the centripetal term alone.
//
// specs/program.md § Axis motion: "a cruising tick, one whose clamp left `v` as
// it was, reports `0`". The arm is turning at its commanded rate on such a tick,
// so specs/statics.md still gives every arm node the centripetal acceleration
// `-omega^2 * r`; what a cruising tick does not carry is the tangential
// `-alpha * (k x r)`.
//
// THE CRUISING TICK IS FOUND FROM THE AXIS ITSELF: the first tick that left the
// rate exactly where it found it, with the rate at the commanded figure and the
// command still live, is the reading. That is the clamp's own signature — the
// drive term computed `v + s * a * dt` and the clamp gave back `v`.
//
// THE RATE IS POSED RATHER THAN RAMPED UP TO. The move is a half turn at the
// slew's max rate, and the ramp to that rate is a second of run clock this point
// is not about: `setAxisRate` "poses a precondition like every other pose rather
// than an outcome ... Posing a rate onto an axis that is under a command sets
// what that axis is doing as the controller next reads it"
// (`specs/instrumentation.md`). So the axis is put AT the commanded rate, which
// is the precondition a cruising tick needs, and the cruising tick itself is
// still earned: the controller computes `v + s * a * dt` on the next tick and its
// own clamp is what gives `v` back. The target stays half a turn away, far
// outside the braking distance `v * v / (2 * a)` of `15` degrees, so the tick the
// sweep finds is a clamped drive and not a brake or an arrival.
//
// The centripetal term is at its largest at this rate — which is the term this
// reading has to see through. The figure is recovered from the tick's own member
// forces at the rail tip, where the node equilibrium makes the tangential part
// separable from the centripetal one exactly, and a build that reported the drive
// term on a cruising tick lands `30` from what this asserts.
//
// The yard is emptied so nothing hangs on the hook, and the minimal crane is the
// crane the NODE comment describes.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear, fail } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  RAIL_MASS_PER_UNIT,
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

/** Far enough that the axis is still cruising when the sweep finds its tick. */
const TARGET = 180;

/**
 * Ticks the sweep is given to find the cruising tick.
 *
 * With the rate posed at the commanded figure the very next tick cruises, so this
 * is slack rather than a budget: a build whose `setAxisRate` did not take, or
 * whose clamp never leaves `v` alone, is what runs it out.
 */
const CAP = 20;

it("builds a cruising tick's inertial loads from an acceleration of zero", async () => {
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

  // The first tick takes the move step and issues its command, so from here the
  // slew is an axis under a live command — which is the state `setAxisRate` poses
  // onto.
  await runTicks(h, 1);
  await h.debug.setAxisRate("slew", SLEW_MAX_RATE);
  const posed = await h.snapshot();
  assertNear(
    posed.run.axes.slew.rate,
    SLEW_MAX_RATE,
    1e-9,
    "the slew's rate once it is posed at the commanded figure, which is the " +
      "precondition a cruising tick needs (specs/instrumentation.md)",
  );

  let was = posed.run.axes.slew.rate;
  let cruising: GantrySnapshot | null = null;
  for (let tick = 1; tick <= CAP && cruising === null; tick += 1) {
    const state = await runTicks(h, 1);
    const now = state.run.axes.slew;
    // A cruising tick: the clamp left the rate as it was, at the commanded
    // figure, with the command still live.
    if (now.command !== null && now.rate === was && now.rate !== 0) {
      cruising = state;
    }
    was = now.rate;
  }
  if (cruising === null) {
    fail(
      `a tick of the move to ${TARGET} degrees whose slew rate the clamp left ` +
        `as it was, within ${CAP} ticks of the rate being posed at ` +
        `${SLEW_MAX_RATE} (specs/program.md)`,
      "no tick cruised",
    );
  }

  await h.capture("state", "The arm on a cruising tick of a slew move");

  const tick = cruising as GantrySnapshot;
  assertNear(
    tick.run.axes.slew.rate,
    SLEW_MAX_RATE,
    1e-9,
    "the slew's rate on the cruising tick, which is the commanded rate the " +
      "clamp holds it at (specs/program.md)",
  );
  assertNear(
    reportedSlewAccel(tick),
    0,
    TOLERANCE,
    "the slew acceleration the cruising tick's member forces were built from: " +
      "the clamp left the rate as it was, so the tick reports 0 and the arm's " +
      "inertial load carries the centripetal term alone (specs/program.md, " +
      "specs/statics.md)",
  );
});
