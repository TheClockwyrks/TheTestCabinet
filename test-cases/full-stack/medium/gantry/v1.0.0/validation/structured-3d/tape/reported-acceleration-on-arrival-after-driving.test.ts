// tape/reported-acceleration-on-arrival-after-driving — a tick that arrives
// while it was still driving reports `0` too.
//
// specs/program.md § Axis motion: "A tick that arrives reports `0`, whether it
// braked or drove on the way in." This is the driving half of that sentence, and
// it is the half a build is most likely to miss: the tick ran the drive branch,
// changed `v`, and would have reported `+s * a` — but the advance crossed the
// target, so step 3 arrived and the tick reports `0`.
//
// THE TARGET IS CLOSER THAN ONE TICK'S TRAVEL. The slew starts at rest, so the
// first tick drives the rate to `SLEW_ACCEL / TICK_HZ` (`0.5` deg/s) and advances
// the axis by `0.5 / TICK_HZ` (`0.008333` degrees). A target of `0.005` degrees
// is inside that advance, so `s * (T - x) <= 0` holds and the axis arrives on the
// very tick it was issued on — a tick that drove, and reports `0`.
//
// The reading is taken from that tick's own member forces at the rail tip. The
// axis is stopped on it, so `omega` is `0` and the applied force at the node is
// its weight alone; a build that reported the drive term on an arriving tick
// lands `30` from what this asserts.
//
// The yard is emptied so nothing hangs on the hook, and the minimal crane is the
// crane the NODE comment describes.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear, fail } from "../assert";
import {
  CABLE_MASS_PER_UNIT,
  RAIL_MASS_PER_UNIT,
  SLEW_MAX_RATE,
  STRUT_MASS_PER_UNIT,
} from "../constants";
import {
  createHarness,
  distance3,
  emptyYard,
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

/** Closer than the `0.008333` degrees the first tick of a slew move advances. */
const TARGET = 0.005;

it("builds an arriving tick's inertial loads from an acceleration of zero after driving", async () => {
  await openSite(h, 0);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, [
    {
      kind: "move",
      commands: [{ axis: "slew", target: TARGET, rate: SLEW_MAX_RATE }],
    },
  ]);
  await startRun(h);

  const first = await runTicks(h, 1);

  await h.capture(
    "state",
    "The arm on a tick that arrived while it was still driving",
  );

  assertEqual(
    first.run.axes.slew.value,
    TARGET,
    "the slew's value after the first tick: the drive advanced it past a " +
      "target inside one tick's travel, so the tick arrived (specs/program.md)",
  );
  assertEqual(
    first.run.axes.slew.rate,
    0,
    "the slew's rate after the arriving tick (specs/program.md)",
  );
  assertNear(
    reportedSlewAccel(first),
    0,
    TOLERANCE,
    "the slew acceleration the arriving tick's member forces were built from: " +
      "a tick that arrives reports 0 even though it drove on the way in " +
      "(specs/program.md, specs/statics.md)",
  );
});
