// tape/command-out-of-range-after-a-rail-break — a trolley target the track no
// longer reaches is out of range at its own step's start.
//
// `specs/program.md` § The tape: "The trolley's range is the one that moves
// during a run: its upper bound is the track's current length
// (`specs/structure.md`), and a rail breaking mid-run shortens the track. A
// `trolley` target that was inside the range while an earlier step ran is out of
// range when its own step starts if the track has since fallen short of it."
// `specs/statics.md` says the same thing from the structure's side: "A break
// outboard of the trolley simply shortens the track, and the trolley axis's range
// shortens with it."
//
// WHAT MAKES THE POINT DIFFERENT FROM AN ORDINARY OUT-OF-RANGE TARGET is that the
// target is legal when the tape is written and legal when the run starts, and
// becomes illegal only because the structure changed under it. So the scenario has
// to break a rail with the real solver — the run's own physics, never a pose — and
// then reach the trolley step.
//
// THE CRANE. The reference crane for Long Reach, with three changes, all of them
// aimed at making one rail the only member that gives way:
//
//   - Its two outboard rails, `(8, 6, 0)-(12, 6, 0)` and `(12, 6, 0)-(16, 6, 0)`,
//     are replaced by `(8, 6, 0)-(10, 6, 0)` and `(10, 6, 0)-(16, 6, 0)`. The
//     track still runs from `(0, 6, 0)` to `(16, 6, 0)` over an unbroken line of
//     rails, so it is the same track of the same length; but its outermost rail is
//     now `RAIL_MAX_LEN` (`6`) long, and `specs/structure.md` reduces a member's
//     compression capacity by `(BUCKLE_REF / L)^2`, which leaves that one rail
//     bearing `1066.7` where every other member of the crane bears `2400`.
//   - A counterweight on the jib tip at `(16, 6, 0)`, whose `COUNTERWEIGHT_MASS`
//     (`80`) is what drives the outer rail past that reduced capacity.
//   - Bracing so the crane still stands with the outer rail gone: the new node
//     `(10, 6, 0)` is tied into the jib, `(12, 6, 0)` keeps a strut path of its
//     own, and two more cables reach the tip from `(2, 14, ·)`.
//
// The result is a crane the static check says stands, whose outer rail is the one
// member over its capacity and the only one that breaks, and whose jib still
// stands once it has. Every figure in it comes from `specs/structure.md` and
// `specs/statics.md`, and every one of them is decided by the build's own solver.
//
// THE TAPE IS TWO STEPS. The first turns the empty hook half a degree, which
// takes some nine ticks and is there only to be the "earlier step" the rule
// speaks of — the rail gives way on the run's first tick, while that step is
// running. "Turning the grip applies no force to anything" (specs/rigging.md),
// so the step is a step and nothing else: the break is the solver's answer to
// the crane, not to what the tape was doing. The second step targets the trolley
// at `14`, which is inside the intact track's length of `16` (`4 + 4 + 2 + 6`)
// and outside the `10` the three surviving rails leave. Nothing about the first
// step touches the trolley, so the only thing that has changed by the time the
// second step starts is the track.
//
// The yard is emptied: nothing here concerns a load.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNull } from "../assert";
import { GRIP_MAX_RATE, TROLLEY_MAX_RATE } from "../constants";
import {
  DESIGNS,
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  runUntil,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type LatticeNode,
  type TapeStepSpec,
} from "../harness";

/** The site the reference crane below was authored for. */
const SITE = 3;

/** The reference crane's two outboard rails, which this scenario re-cuts. */
const REPLACED: readonly (readonly [LatticeNode, LatticeNode])[] = [
  [
    [8, 6, 0],
    [12, 6, 0],
  ],
  [
    [12, 6, 0],
    [16, 6, 0],
  ],
];

/** The same stretch of track, re-cut so its outermost rail is RAIL_MAX_LEN long. */
const RECUT: readonly DesignMember[] = [
  [[8, 6, 0], [10, 6, 0], "rail"],
  [[10, 6, 0], [16, 6, 0], "rail"],
];

/** What holds the jib together around the re-cut rails, with and without them. */
const BRACING: readonly DesignMember[] = [
  [[8, 6, 2], [10, 6, 0], "strut"],
  [[12, 6, 2], [10, 6, 0], "strut"],
  [[0, 14, 0], [10, 6, 0], "cable"],
  [[0, 14, 2], [10, 6, 0], "cable"],
  [[12, 6, 0], [8, 6, 2], "strut"],
  [[12, 6, 0], [16, 6, 2], "strut"],
  [[2, 14, 0], [16, 6, 0], "cable"],
  [[2, 14, 2], [16, 6, 0], "cable"],
];

/** The tip node the counterweight hangs on, and the outer rail's far end. */
const TIP: LatticeNode = [16, 6, 0];

/** The two nodes of the rail this scenario expects to give way. */
const OUTER_RAIL: readonly [LatticeNode, LatticeNode] = [
  [10, 6, 0],
  [16, 6, 0],
];

/** The intact track: 4 + 4 + 2 + 6 units of rail from (0, 6, 0) to (16, 6, 0). */
const INTACT_TRACK = 16;

/** What the three rails inboard of the outer one leave. */
const SHORTENED_TRACK = 10;

/** Inside the intact track, outside the shortened one. */
const TROLLEY_TARGET = 14;

/** A pair of nodes, in an order that reads the same either way round. */
function edge(a: LatticeNode, b: LatticeNode): string {
  const one = a.join(",");
  const two = b.join(",");
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

const CUT = new Set(REPLACED.map(([a, b]) => edge(a, b)));

const DESIGN: CraneDesign = {
  ...DESIGNS[SITE]!,
  members: [
    ...DESIGNS[SITE]!.members.filter(([a, b]) => !CUT.has(edge(a, b))),
    ...RECUT,
    ...BRACING,
  ],
  counterweights: [...DESIGNS[SITE]!.counterweights, TIP],
};

const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 0.5, rate: GRIP_MAX_RATE }],
  },
  {
    kind: "move",
    commands: [
      { axis: "trolley", target: TROLLEY_TARGET, rate: TROLLEY_MAX_RATE },
    ],
  },
];

/** The grip step is some nine ticks; this bounds a run that never ends. */
const CAP = 40;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run when the trolley step starts on a track that has fallen short", async () => {
  await openSite(h, SITE);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await poseCrane(h, DESIGN);
  await poseTape(h, TAPE);
  await startRun(h);

  // The rail gives way under the solver on the run's first tick, while the tape's
  // first step is running: the track falls from INTACT_TRACK to SHORTENED_TRACK.
  const broke = await runTicks(h, 1);
  const members = (await h.snapshot()).structure.members;
  const gone = broke.run.broken.map((id) => {
    const m = members.find((one) => one.id === id);
    return m === undefined
      ? `${id}`
      : edge([m.a.x, m.a.y, m.a.z], [m.b.x, m.b.y, m.b.z]);
  });
  assertGreaterThan(
    broke.run.broken.length,
    0,
    "the members the solver broke on the run's first tick, which is what " +
      "shortens the track (specs/statics.md)",
  );
  assertEqual(
    gone.join(" "),
    edge(OUTER_RAIL[0], OUTER_RAIL[1]),
    "the member that gave way: the outermost rail alone, so the rails left " +
      `form a track of ${SHORTENED_TRACK} (specs/statics.md)`,
  );
  assertEqual(
    broke.run.phase,
    "running",
    "the phase after the break: a break outboard of the trolley shortens the " +
      "track and the run carries on (specs/statics.md)",
  );
  assertNull(
    broke.run.cause,
    "the failure cause after the break, before the trolley step has started",
  );

  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    CAP,
    "the run to reach the trolley step and end on it",
  );
  await h.capture("state", "The driven state this point decides");

  assertEqual(
    ended.run.stepIndex,
    1,
    `the step the run ended on: the trolley move to ${TROLLEY_TARGET}, which ` +
      `was inside the intact track's ${INTACT_TRACK} (specs/program.md)`,
  );
  assertEqual(
    ended.run.phase,
    "failed",
    `the phase of a run whose trolley step targets ${TROLLEY_TARGET} on a ` +
      `track the break left ${SHORTENED_TRACK} long (specs/program.md)`,
  );
  assertEqual(
    ended.run.cause,
    "command-out-of-range",
    "the cause a trolley target the shortened track no longer reaches ends " +
      "the run with, at its own step's start (specs/program.md)",
  );
});
