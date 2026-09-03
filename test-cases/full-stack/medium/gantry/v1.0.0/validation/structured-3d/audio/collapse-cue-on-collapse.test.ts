// audio/collapse-cue-on-collapse — a run that fails as `collapse` sounds the
// collapse cue.
//
// specs/ui.md § Audio: "| `collapse` | a run fails as `collapse` or
// `ring-overload` |". This point is the first of those two causes; the second
// has its own check, because a build that sounds the cue for one and not the
// other must grade differently from one that sounds it for neither.
//
// THE CRANE IS A MECHANISM BY CONSTRUCTION, so the collapse is the specification's
// own and arrives with nothing else on the tick. It is the minimal crane with
// every diagonal taken out of its tower: the four legs and the bottom-flange
// square form an unbraced box, and translating that square sideways stretches no
// leg and no flange edge to first order — a zero-energy mode, so the tower solve
// is singular and specs/statics.md ends the run as `collapse` on the tick the
// solves reach. Every readiness rule still holds (its ring, its one horizontal
// rail in the arm with ends at distinct radii, every member reaching an anchor or
// a flange), so specs/program.md refuses nothing and the run starts.
//
// Nothing breaks on the way: the arm above the ring is left braced and no member
// is anywhere near its capacity, so the tick that fails is a bare singular solve
// rather than a breakage that cascaded. The yard is emptied, so no obstacle and
// no load can reach a verdict first.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertLength } from "../assert";
import { HOIST_MAX_RATE, HOIST_START } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  startRun,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; a singular solve is singular on every one. */
const SITE = 0;

/**
 * The minimal crane with its tower's bracing removed: ready, and a mechanism.
 *
 * The legs and the bottom-flange square are all that reach the ground, and with
 * no diagonal anywhere in that box the tower has a zero-energy sway mode. The
 * arm above the ring is untouched, and is rigid, so the solve that goes singular
 * is the tower's.
 */
const UNBRACED_TOWER: CraneDesign = {
  site: SITE,
  name: "Unbraced tower",
  ring: [0, 2, 0],
  counterweights: [],
  members: [
    // The four legs, anchor to bottom flange.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    // The bottom flange square, and no diagonal across it.
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // The track, and the three ties that hold its far end up.
    [[0, 4, 0], [4, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[2, 4, 2], [4, 4, 0], "strut"],
    [[0, 8, 0], [4, 4, 0], "strut"],
  ],
  tape: [],
};

/** One short move: the least that keeps `empty-program` off the issue list. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [
      { axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE },
    ],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the collapse cue when a run fails as collapse", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, UNBRACED_TOWER);
  await poseTape(h, TAPE);

  await startRun(h);
  await h.cues(); // the start's own `run-start`, drained
  const failed = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the run screen on the tick the tower collapsed");

  assertEqual(
    failed.run.cause,
    "collapse",
    "the cause the run failed with: a singular tower solve ends the run as " +
      "`collapse` (specs/statics.md)",
  );
  assertLength(
    failed.run.broken,
    0,
    "the members that broke on the way: none, so the tick carries the " +
      "singular solve alone (specs/statics.md)",
  );
  assertContains(
    played,
    "collapse",
    "the cues that tick sounded: `collapse` plays when a run fails as " +
      "`collapse` (specs/ui.md § Audio)",
  );
});
