// simulation/trolley-drive-term — the trolley point's acceleration carries its
// drive along the track.
//
// specs/statics.md, The load model: "The trolley point adds its own motion along
// the track: with `u` the track's world direction (unit, origin end toward far
// end), `v` and `w` the trolley's rate and acceleration along it,
// `a_trolley = -omega^2 * r - alpha * (k x r) + w * u - 2 * omega * (k x u) * v`."
// The force a lumped mass applies is `m * g - m * a`, so the `w * u` term applies
// at the trolley point a force of `m * w` back along the track, towards the
// origin, when the trolley is driven outward.
//
// Three readings at the SAME geometry. The trolley stands halfway along the rail
// from the track origin `(4, 6, 0)` to `(6, 6, 0)` on every one of them — the
// two driving readings start a controller-tick's worth of travel short of it and
// behind it, so all three arrive at `trolley` `1` before the solve runs — and the
// arm never turns, so `omega` and `alpha` are zero throughout and `u` is the
// track's build direction. What separates the three is `w` alone: the first tick
// of a move outward drives at `+TROLLEY_ACCEL`, the first tick of a move inward
// at `-TROLLEY_ACCEL`, and a trolley under no command holds still and reports `0`
// (`specs/program.md`).
//
// The member read is the rail leaving the track origin. That node carries exactly
// one rail, one mast cable and one sideways brace, and the cable and the brace are
// the only members there with a `y` and a `z` component: a change in `w` moves
// only the force applied along the track, which is horizontal and along `x`, so
// the cable's force and the brace's force do not move at all and the whole of the
// change lands on the rail. It is therefore exactly the share of `m * w` lumped
// at that node — half of the trolley's mass, from the halfway position — and it
// reverses with the drive.

import { afterEach, beforeEach, it } from "vitest";
import { assertClose, fail } from "../assert";
import {
  HOIST_MAX_RATE,
  HOIST_START,
  TICK_HZ,
  TROLLEY_ACCEL,
  TROLLEY_MASS,
  TROLLEY_MAX_RATE,
} from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type GantrySnapshot,
  type Harness,
  type MemberForce,
  type TapeStepSpec,
} from "../harness";

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

/** The rail leaving the track origin `(4, 6, 0)`. */
const RAIL_IN = 20;

/** Where all three readings stand the trolley: halfway along that rail. */
const AT = 1;

/** The share of the trolley point's load that node carries from there. */
const SHARE = 0.5;

/** The track's length, which is what a move outward is aimed at. */
const TRACK_LENGTH = 4;

/** One tick of simulation, in seconds (`specs/overview.md`). */
const DT = 1 / TICK_HZ;

/** How far one driving tick carries the trolley from rest: `w * dt * dt`. */
const CREEP = TROLLEY_ACCEL * DT * DT;

/**
 * Empty the tape, append `steps`, and start a run on them.
 *
 * The tape poses apply on the program screen alone (`specs/instrumentation.md`),
 * so the screen is taken there to empty it and put back before the start, which
 * `specs/program.md` allows from the build or the program screen.
 */
async function freshRun(steps: readonly TapeStepSpec[]): Promise<void> {
  await h.debug.setScreen("program");
  await h.debug.clearProgram();
  await h.debug.setScreen("build");
  await poseTape(h, steps);
  await startRun(h);
}

/** End the reading's run and stand back on the build screen. */
async function endRun(): Promise<void> {
  await h.debug.abortRun();
  await h.debug.setScreen("build");
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

/**
 * One tick of a fresh run, with the trolley posed to arrive at {@link AT}.
 *
 * `target` is the trolley target the tape commands, or `null` for a tick under no
 * trolley command at all; `from` is where the trolley is posed before the tick.
 * A pose leaves the axis "stopped with no live command"
 * (`specs/instrumentation.md`), so a commanded axis starts the tick at rest and
 * the controller's first tick is a full drive at `TROLLEY_ACCEL`
 * (`specs/program.md`).
 */
async function readDrive(
  target: number | null,
  from: number,
): Promise<GantrySnapshot> {
  const step: TapeStepSpec =
    target === null
      ? {
          kind: "move",
          commands: [
            { axis: "hoist", target: HOIST_START, rate: HOIST_MAX_RATE },
          ],
        }
      : {
          kind: "move",
          commands: [{ axis: "trolley", target, rate: TROLLEY_MAX_RATE }],
        };
  await freshRun([step]);
  await h.debug.setAxis("trolley", from);
  const s = await runTicks(h, 1);
  assertClose(
    s.run.axes.trolley.value,
    AT,
    1e-9,
    "where the tick left the trolley, which every reading shares " +
      "(specs/program.md)",
  );
  assertClose(
    s.run.axes.trolley.rate,
    target === null ? 0 : Math.sign(target - from) * TROLLEY_ACCEL * DT,
    1e-9,
    "the rate the tick left, which is what says the controller drove at " +
      "TROLLEY_ACCEL (specs/program.md)",
  );
  return s;
}

it("pushes back along the track at the trolley's node while it is driven", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, RIG);

  const stopped = await readDrive(null, AT);
  await endRun();
  const outward = await readDrive(TRACK_LENGTH, AT - CREEP);
  await h.capture(
    "trolley-driven-outward",
    "the first driving tick of a trolley move outward along the track",
  );
  await endRun();
  const inward = await readDrive(0, AT + CREEP);

  // The along-track force the drive applies, shared to this rail's node.
  const along = SHARE * TROLLEY_MASS * TROLLEY_ACCEL;
  const held = forceOf(stopped.run.forces, RAIL_IN);
  assertClose(
    forceOf(outward.run.forces, RAIL_IN) - held,
    along,
    1e-6,
    "how the rail's force moves on the first tick of a move outward: the " +
      "trolley point applies m * w back along the track (specs/statics.md)",
  );
  assertClose(
    forceOf(inward.run.forces, RAIL_IN) - held,
    -along,
    1e-6,
    "how it moves on the first tick of a move inward, which is the same " +
      "figure the other way (specs/statics.md)",
  );
});
