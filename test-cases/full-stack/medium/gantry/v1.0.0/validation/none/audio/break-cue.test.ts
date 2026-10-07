// audio/break-cue — a tick that breaks a member sounds the break cue.
//
// specs/ui.md § Audio: "| `break` | a tick breaks one or more members, once for
// the tick |". specs/statics.md § Utilization and breakage says the same where
// the breakage is decided: "Breakage that leaves the structure standing plays
// the `break` cue and the run continues without the broken members."
//
// THE SCENARIO IS A BREAK THE CRANE SURVIVES, which is the case both sentences
// agree on. That takes a crane with a member over its capacity and somewhere else
// for that member's load to go: on the minimal crane every member is the only
// thing doing its job, so the first member to go takes the structure with it and
// the tick is a `collapse` as much as a break.
//
// THE OVERLOAD IS THE CRANE'S OWN WEIGHT, AND NOTHING ELSE IS IN THE YARD. The
// tower carries its corner at `(2, 0, 0)` up to the ring by several parallel
// paths — a length-6 leg straight to the bottom flange, a length-4 leg to an
// inner frame, and a stack through `(2, 2, 0)`. specs/structure.md lets the long
// leg run past the nodes it crosses — "two members whose segments cross in space
// are not joined there and pass through one another freely" — and it is the
// weakest of them, because a strut's compression capacity falls as
// `min(1, (BUCKLE_REF / L)^2)` and at length 6 that is `4 / 9` of
// `STRUT_CAP_COMPRESSION`. Four counterweights load that corner until the long leg
// alone goes past its capacity on the run's first solve; it breaks, the paths
// beside it take up its load, and the run carries on. That is the tick this point
// listens to.
//
// NOTHING HANGS ON THE HOOK AND NOTHING ELSE MOVES. The yard is emptied, so no
// load, no lift and no cable tension is on the way to the breakage — each of
// those belongs to another point — and the tape is one long `grip` move, the one
// axis specs/rigging.md says "applies no force to anything", so the crane just
// stands there under its own weight and its counterweights. The run's own
// `run-start` cue is drained before the tick, so what is read is what that tick
// sounded.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type DesignMember,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** Site 1, First Lift: which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The leg that breaks: length 6, so its compression capacity is 4/9 of a strut's. */
const BREAKER: DesignMember = [[2, 0, 0], [2, 6, 0], "strut"];

/** Everything else, which both cranes carry. */
const REST: readonly DesignMember[] = [
  // The other three long legs, anchor to the ring's bottom flange at y = 6.
  [[0, 0, 0], [0, 6, 0], "strut"],
  [[0, 0, 2], [0, 6, 2], "strut"],
  [[2, 0, 2], [2, 6, 2], "strut"],
  // The length-4 legs, to an inner frame the long legs run past.
  [[0, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [0, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 2], "strut"],
  // The inner frame at y = 4, and its anchor braces.
  [[0, 4, 0], [2, 4, 0], "strut"],
  [[0, 4, 2], [2, 4, 2], "strut"],
  [[0, 4, 0], [0, 4, 2], "strut"],
  [[2, 4, 0], [2, 4, 2], "strut"],
  [[0, 4, 0], [2, 4, 2], "strut"],
  [[0, 0, 0], [2, 4, 0], "strut"],
  [[0, 0, 2], [2, 4, 2], "strut"],
  [[2, 0, 2], [2, 4, 0], "strut"],
  // The frame up to the bottom flange, and the flange square.
  [[0, 4, 0], [0, 6, 0], "strut"],
  [[2, 4, 0], [2, 6, 0], "strut"],
  [[0, 4, 2], [0, 6, 2], "strut"],
  [[2, 4, 2], [2, 6, 2], "strut"],
  [[0, 6, 0], [2, 6, 0], "strut"],
  [[0, 6, 2], [2, 6, 2], "strut"],
  [[0, 6, 0], [0, 6, 2], "strut"],
  [[2, 6, 0], [2, 6, 2], "strut"],
  [[0, 6, 0], [2, 6, 2], "strut"],
  [[0, 4, 0], [2, 6, 0], "strut"],
  [[0, 4, 2], [2, 6, 2], "strut"],
  [[2, 4, 2], [2, 6, 0], "strut"],
  // The stack beside the long leg, so its load has somewhere else to go.
  [[2, 0, 0], [2, 2, 0], "strut"],
  [[2, 2, 0], [2, 4, 0], "strut"],
  [[2, 2, 0], [2, 6, 0], "strut"],
  [[2, 2, 0], [0, 0, 0], "strut"],
  [[2, 2, 0], [0, 0, 2], "strut"],
  [[2, 2, 0], [2, 0, 2], "strut"],
  [[2, 0, 0], [0, 4, 0], "strut"],
  [[2, 0, 0], [2, 4, 2], "strut"],
  [[2, 2, 0], [0, 4, 0], "strut"],
  [[2, 2, 0], [2, 4, 2], "strut"],
  [[2, 2, 0], [0, 4, 2], "strut"],
  // The jib on the top flange: a mast head, two rails, and their hangers.
  [[2, 8, 0], [2, 12, 0], "strut"],
  [[2, 12, 0], [2, 8, 2], "strut"],
  [[2, 12, 0], [0, 8, 2], "strut"],
  [[2, 12, 0], [0, 8, 0], "strut"],
  [[2, 8, 0], [4, 8, 0], "rail"],
  [[4, 8, 0], [6, 8, 0], "rail"],
  [[2, 12, 0], [4, 8, 0], "strut"],
  [[2, 12, 0], [6, 8, 0], "strut"],
  [[4, 8, 0], [2, 8, 2], "strut"],
  [[6, 8, 0], [2, 8, 2], "strut"],
];

/** The load that takes the long leg past its capacity, and nothing else. */
const COUNTERWEIGHTS = [
  [2, 6, 0],
  [2, 4, 0],
  [2, 2, 0],
  [6, 8, 0],
] as const;

/** The crane, and the leg that goes on its first solve. */
const CRANE: CraneDesign = {
  site: 1,
  name: "Overloaded-leg tower",
  ring: [0, 6, 0],
  counterweights: COUNTERWEIGHTS,
  members: [BREAKER, ...REST],
  tape: [],
};

/** One move that turns the hook and applies no force (specs/rigging.md). */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100000, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the break cue on the tick a member breaks", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await poseCrane(h, CRANE);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.cues(); // the start's own `run-start`, drained

  const broke = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the crane on the tick a member broke under it");

  assertLength(
    broke.run.broken,
    1,
    "the members the run's first solve took: the overloaded leg alone " +
      "(specs/statics.md)",
  );
  assertEqual(
    broke.run.phase,
    "running",
    "the run on that tick: the breakage left the structure standing, so the " +
      "run carries on without the broken members (specs/statics.md)",
  );
  assertContains(
    played,
    "break",
    "the cues that tick sounded: `break` plays when a tick breaks one or " +
      "more members (specs/ui.md § Audio)",
  );
});
