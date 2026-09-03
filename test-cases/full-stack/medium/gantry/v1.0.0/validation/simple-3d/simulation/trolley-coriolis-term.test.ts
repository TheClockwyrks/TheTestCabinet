// simulation/trolley-coriolis-term — the trolley point's acceleration carries the
// Coriolis term.
//
// specs/statics.md, The load model:
// `a_trolley = -omega^2 * r - alpha * (k x r) + w * u - 2 * omega * (k x u) * v`,
// "where `k x u` is the vector `(u.z, 0, -u.x)`. The last term is the Coriolis
// contribution of driving the trolley while the arm turns, and it runs the same
// way as the tangential term: driving the trolley outward while the arm turns
// from `+x` toward `+z` accelerates it toward `+z`." The force a lumped mass
// applies is `m * g - m * a`, so that acceleration gains the node a force of
// `2 * m * omega * v` toward `-z`.
//
// The term is a product of `omega` and `v`, so it is read as a second difference:
// four readings at rates `(0, 0)`, `(W, 0)`, `(0, V)` and `(W, V)`, and
// `(W, V) - (W, 0) - (0, V) + (0, 0)`, which cancels everything that depends on
// only one of the two and leaves the cross term alone.
//
// All four readings are taken at IDENTICAL geometry — `slew` `0` and `trolley`
// `1` after the tick — which is what makes that cancellation exact. Each moving
// axis is posed a tick's travel short of where it must arrive and given its rate,
// and its tape command is aimed far enough off that the controller cruises: a
// cruising tick "reports `0`" for acceleration (`specs/program.md`), so `alpha`
// and `w` are zero on every reading and the centripetal and drive terms are
// identical within each pair. The readings are first ticks, where
// `specs/rigging.md` fixes the bob's acceleration at zero, so the cable force is
// the hook's weight straight down on all four and contributes no `z` at all.
//
// The member read is the sideways brace at the track origin — the only member at
// that node with a `z` component, so the node's `z` equilibrium fixes its force
// at `-F.z / n.z`, and the second difference of that force is the cross term
// alone: half of `TROLLEY_MASS` (the trolley stands halfway along its rail) times
// `2 * omega * v`, resolved through the brace's own direction. A build that
// dropped the term reads zero; one that ran it the wrong way reads the negative.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, assertLength, fail } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  SLEW_MAX_RATE,
  TICK_HZ,
  TROLLEY_MASS,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  createHarness,
  openSite,
  poseCrane,
  runTicks,
  startRun,
  type CraneDesign,
  type GantrySnapshot,
  type Harness,
  type MemberForce,
} from "../harness";

/** One command of a move step: an axis, where it is driven, and how fast. */
interface Command {
  readonly axis: "slew" | "trolley" | "hoist" | "grip";
  readonly target: number;
  readonly rate: number;
}

/**
 * The rig every reading below is taken on, and why it is shaped this way.
 *
 * It is a plain crane, built under the rules of `specs/structure.md` alone, but
 * three of its nodes are arranged so that one member's force is fixed by a single
 * equation rather than by the whole solve, which is what lets a reading be
 * compared against a figure the specification states:
 *
 *   - The tower is the braced box from the four anchors to the ring's bottom
 *     flange at `(0, 4, 0)`. The bottom-flange corner `(0, 4, 0)` is reached by
 *     its vertical leg (id 0) and by horizontals alone, so vertical equilibrium
 *     there reads `N = F.y` on that leg and on nothing else.
 *   - The arm is a mast head at `(2, 10, 0)` tied to all four top-flange nodes, a
 *     spur node at `(4, 6, 2)`, and the track `(4, 6, 0)-(6, 6, 0)-(8, 6, 0)`.
 *   - Each of the three track nodes is hung from the mast by ONE cable — the only
 *     member at that node with a `y` component — and braced sideways by
 *     horizontals, one of which is the only member there with a `z` component. So
 *     the cable carries the whole vertical load lumped at its node, `V / |n.y|`,
 *     and the sideways brace the whole `z` load.
 *   - The track origin is `(4, 6, 0)`, the end nearer the slew axis, and it is an
 *     ordinary arm node carrying exactly one rail — so the rail's force follows
 *     from that node's `x` equilibrium once the other two are known.
 *
 * Every node lies inside the envelope of the site each reading opens, the crane
 * costs well under that site's budget, and `check` reports no issue and a
 * structure that stands.
 */
const RIG: CraneDesign = {
  site: 1,
  name: "Reference rig",
  ring: [0, 4, 0],
  counterweights: [],
  members: [
    // The tower: four legs, the bottom-flange square and one diagonal across it,
    // and one diagonal on each of the box's four sides.
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
    [[0, 0, 0], [0, 4, 2], "strut"],
    [[2, 0, 0], [2, 4, 2], "strut"],
    [[0, 0, 2], [2, 4, 2], "strut"],
    // The mast head, tied to all four top-flange nodes.
    [[2, 6, 0], [2, 10, 0], "strut"],
    [[0, 6, 0], [2, 10, 0], "strut"],
    [[2, 6, 2], [2, 10, 0], "strut"],
    [[0, 6, 2], [2, 10, 0], "strut"],
    // The spur node the outboard sideways braces run back to.
    [[2, 6, 2], [4, 6, 2], "strut"],
    [[2, 6, 0], [4, 6, 2], "strut"],
    [[2, 10, 0], [4, 6, 2], "strut"],
    // The track, and the cable and the sideways brace at each of its nodes.
    [[4, 6, 0], [6, 6, 0], "rail"],
    [[6, 6, 0], [8, 6, 0], "rail"],
    [[2, 10, 0], [4, 6, 0], "cable"],
    [[2, 6, 2], [4, 6, 0], "strut"],
    [[2, 10, 0], [6, 6, 0], "cable"],
    [[2, 6, 2], [6, 6, 0], "strut"],
    [[2, 10, 0], [8, 6, 0], "cable"],
    [[4, 6, 2], [8, 6, 0], "strut"],
    [[4, 6, 2], [6, 6, 0], "strut"],
  ],
  tape: [],
};

/** The sideways brace at the track origin, and the two nodes it runs between. */
const BRACE_ORIGIN = 23;
const ORIGIN = [4, 6, 0] as const;
const BRACED_TO = [2, 6, 2] as const;

/** Where every reading stands the trolley: halfway along the first rail. */
const AT = 1;

/** The share of the trolley point's load that node carries from there. */
const SHARE = 0.5;

/** The track's length, which a trolley move is aimed at. */
const TRACK_LENGTH = 4;

/** A slew target far enough off that the controller cruises all tick. */
const SLEW_TARGET = 90;

/** One tick of simulation, in seconds (`specs/overview.md`). */
const DT = 1 / TICK_HZ;

/** The unit direction from `from` towards `to`. */
function direction(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): { x: number; y: number; z: number } {
  const d = { x: to[0] - from[0], y: to[1] - from[1], z: to[2] - from[2] };
  const length = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / length, y: d.y / length, z: d.z / length };
}

/**
 * Empty the tape, append one move step carrying `commands`, and start a run.
 *
 * The tape poses apply on the program screen alone (`specs/instrumentation.md`),
 * so the screen is taken there and left there: `specs/program.md` allows a run to
 * start from the build or the program screen, so nothing has to move back.
 */
async function freshRun(commands: readonly Command[]): Promise<void> {
  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  const [first, ...rest] = commands;
  await h.debug.addMoveStep(first!.axis, first!.target, first!.rate);
  for (const command of rest) {
    await h.debug.addCommand(0, command.axis, command.target, command.rate);
  }
  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the one move step this reading's tape carries (specs/program.md)",
  );
  assertLength(
    started.program[0]?.kind === "move" ? started.program[0].commands : [],
    commands.length,
    "the commands that step carries, which are what the reading cruises on",
  );
}

/** End the reading's run. */
async function endRun(): Promise<void> {
  await h.debug.abortRun();
}

/** The force the reported member list carries for `id`. */
function forceOf(members: readonly MemberForce[], id: number): number {
  const found = members.find((one) => one.id === id);
  if (found === undefined) {
    fail(`member ${id} to be reported (specs/state.md)`, "it is missing");
  }
  return found.force;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** One tick of a fresh run at slew rate `omega` and trolley rate `v`. */
async function readRates(omega: number, v: number): Promise<GantrySnapshot> {
  const commands: Command[] = [];
  if (omega !== 0) {
    commands.push({ axis: "slew", target: SLEW_TARGET, rate: omega });
  }
  if (v !== 0) {
    commands.push({ axis: "trolley", target: TRACK_LENGTH, rate: v });
  }
  if (commands.length === 0) {
    commands.push({
      axis: "hoist",
      target: HOIST_START,
      rate: HOIST_MAX_RATE,
    });
  }
  await freshRun(commands);

  // Posed a tick's travel short of the geometry every reading shares, and given
  // the rate the controller then cruises at.
  await h.debug.setAxis("slew", -omega * DT);
  if (omega !== 0) await h.debug.setAxisRate("slew", omega);
  await h.debug.setAxis("trolley", AT - v * DT);
  if (v !== 0) await h.debug.setAxisRate("trolley", v);

  const s = await runTicks(h, 1);
  assertClose(
    s.run.axes.slew.value,
    0,
    1e-9,
    "the slew angle the tick left, which every reading shares " +
      "(specs/program.md)",
  );
  assertClose(
    s.run.axes.trolley.value,
    AT,
    1e-9,
    "where the tick left the trolley, which every reading shares " +
      "(specs/program.md)",
  );
  assertClose(
    s.run.axes.slew.rate,
    omega,
    1e-9,
    "the slew rate the tick cruised at (specs/program.md)",
  );
  assertClose(
    s.run.axes.trolley.rate,
    v,
    1e-9,
    "the trolley rate the tick cruised at (specs/program.md)",
  );
  return s;
}

it("applies a force toward -z at the trolley's node while it drives out under slew", async () => {
  await openSite(h, 0);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await poseCrane(h, RIG);

  const W = SLEW_MAX_RATE;
  const V = TROLLEY_MAX_RATE;

  const still = forceOf((await readRates(0, 0)).run.forces, BRACE_ORIGIN);
  await endRun();
  const slewing = forceOf((await readRates(W, 0)).run.forces, BRACE_ORIGIN);
  await endRun();
  const running = forceOf((await readRates(0, V)).run.forces, BRACE_ORIGIN);
  await endRun();
  const both = forceOf((await readRates(W, V)).run.forces, BRACE_ORIGIN);
  await h.capture(
    "trolley-under-slew",
    "the tick that drives the trolley outward while the arm turns",
  );

  // The cross term alone: a force of 2 * m * omega * v toward -z at the node,
  // resolved through the only member there with a z component. The brace runs
  // from the node towards +z, so resisting a force toward -z pulls it into
  // tension and the difference comes out positive.
  const omega = (W * Math.PI) / 180;
  const coriolis = SHARE * TROLLEY_MASS * 2 * omega * V;
  assertClose(
    both - slewing - running + still,
    coriolis / direction(ORIGIN, BRACED_TO).z,
    1e-6,
    "the cross term in the sideways brace's force: 2 * m * omega * v toward " +
      "-z at the trolley's node (specs/statics.md)",
  );
});
