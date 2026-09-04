// tape/start-not-refused-for-a-structure-that-does-not-stand — a crane that the
// check calls unstable still starts its run.
//
// `specs/program.md` § Starting and ending a run closes the door on exactly two
// things: "Starting is refused, with the issues listed and no run begun, when the
// structure has a readiness issue (`specs/structure.md`) or the tape is empty
// (`empty-program`)." Standing up is not among them, and `specs/structure.md`
// says why in as many words: "A structure with no readiness issues is ready to
// run. Whether it stands is the solve's verdict, not the editor's: a ready
// structure may still be a mechanism or collapse under its first load."
//
// So a mechanism runs, and it is the RUN that ends it — "A singular solve, in
// either the arm or the tower … ends the run as `collapse`" (`specs/statics.md`)
// — on the tick the solves reach, which is stage 6 of the run's first tick.
//
// THE CRANE IS A MECHANISM BY CONSTRUCTION, not by chance: it is the minimal
// crane with every diagonal taken out of its tower, so the four legs and the
// bottom-flange square form an unbraced box. Translating that square sideways
// stretches no leg and no flange edge to first order, which is a zero-energy mode
// of the supported system, so the tower solve is singular. Every readiness rule
// still holds: it has its ring, its one horizontal rail lies in the arm with its
// two ends at different horizontal distances from the slew axis, and every member
// reaches an anchor or a flange node — so the check reports no issue at all, and
// the check's own `stable` is what says the structure does not stand.
//
// The arm is left braced so the singular solve is the tower's: the arm solve runs
// first (`specs/statics.md`), and a crane that failed in it would decide the same
// point through a different solve for no reason. The tape is one short move,
// which is the least that keeps `empty-program` off the list.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertTrue } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  type CraneDesign,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/**
 * The minimal crane with its tower's bracing removed: ready, and a mechanism.
 *
 * The legs and the bottom-flange square are all that reach the ground, and with
 * no diagonal anywhere in that box the tower has a zero-energy sway mode. The
 * arm above the ring is untouched, and is rigid.
 */
const UNBRACED_TOWER: CraneDesign = {
  site: 0,
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
    commands: [{ axis: "hoist", target: 3, rate: HOIST_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("starts the run on a ready mechanism and collapses on its first tick", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, UNBRACED_TOWER);
  await poseTape(h, TAPE);

  const result = await h.check();
  assertLength(
    result.issues,
    0,
    "the issues that would refuse a run on a crane with its ring, its rail " +
      "and every member connected, carrying a tape (specs/structure.md)",
  );
  assertTrue(
    !result.stable,
    "whether the unbraced tower stands: its solve is singular, so it does " +
      "not (specs/statics.md)",
  );

  await h.debug.startRun();
  const started = await h.snapshot();
  const first = await runTicks(h, 1);

  await h.capture(
    "started-anyway",
    "The run screen on a crane the check called unstable",
  );

  assertEqual(
    started.screen,
    "run",
    "the screen a start that was not refused moves to (specs/program.md)",
  );
  assertEqual(
    started.run.phase,
    "running",
    "the phase immediately after starting a run on a ready structure that " +
      "does not stand: standing is not what refuses a start " +
      "(specs/program.md)",
  );
  assertEqual(
    first.run.cause,
    "collapse",
    "the cause the first tick's singular tower solve ends the run with, " +
      "which is where a mechanism is caught (specs/statics.md)",
  );
});
