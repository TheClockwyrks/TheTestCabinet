// audio/collapse-cue-on-ring-overload — a run that fails as `ring-overload`
// sounds the collapse cue too.
//
// specs/ui.md § Audio: "| `collapse` | a run fails as `collapse` or
// `ring-overload` |". The row names two causes and one cue, so a build that
// sounds it for a singular solve and stays silent when the ring gives way has
// missed half the requirement — which is why this is its own check beside
// `collapse-cue-on-collapse`.
//
// THE RING IS OVERLOADED BY A CANTILEVER, which is the specification's own
// arithmetic and needs no pose at all. specs/structure.md gives each of the
// ring's eight flange connections a capacity of `RING_CAP` (`6000`), and
// specs/statics.md checks the magnitude carried at each of the four corners
// against it: "a tick on which one exceeds it ends the run as `ring-overload`".
// The crane below is a boom running out to `x = 12` off a ring whose flange
// square spans `x = 0` to `x = 2`, with four counterweights hung on its outboard
// nodes — `COUNTERWEIGHT_MASS` (`80`) each, so `800` of weight apiece at levers
// of eight and twelve against a two-unit support span. The couple that puts on
// the top flange runs past `RING_CAP` at the near corners on the run's very
// first tick.
//
// THE RING CHECK IS REACHED BEFORE ANYTHING ELSE COULD END THE RUN.
// specs/program.md's tick pipeline runs the arm solve, then the ring check, then
// the tower solve, then breakage, so a crane whose members are also past their
// capacities still fails as `ring-overload` — the check that comes first. The
// boom is braced in three dimensions at every node (two chords, cross members,
// plan diagonals, and one mast cable apiece), so the arm solve ahead of it is
// regular rather than singular. The yard is emptied and the tape is one long
// `grip` move, the axis specs/rigging.md says "applies no force to anything", so
// no obstacle, no load and no motion reaches a verdict first.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertTrue } from "../assert";
import { GRIP_MAX_RATE, RING_CAP } from "../constants";
import {
  createHarness,
  emptyYard,
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

/** The site this runs on: its envelope reaches `x = 12`, which the boom needs. */
const SITE = 0;

/**
 * A ring on the minimal tower carrying a braced boom out to `x = 12`.
 *
 * The tower is the minimal crane's, unchanged. Above the ring the arm is a
 * ladder truss in the plane `y = 4`: a chord at `z = 0` and one at `z = 2`, each
 * running out in four-unit bays, tied together by cross members and plan
 * diagonals so the deck is rigid in its own plane, and each outboard node hung
 * from the mast at `(0, 8, 0)` by one cable so the deck is held up. The
 * outermost bay is the rail track — one rail member, horizontal, in the arm,
 * with its two ends at distinct horizontal distances from the slew axis, which
 * is every rule specs/structure.md puts on a track.
 *
 * Four counterweights sit on the two outboard bays. Every node lies inside the
 * site's envelope and the crane costs about `1761` against a budget of `3000`.
 */
const OUTRIGGER: CraneDesign = {
  site: SITE,
  name: "Outrigger",
  ring: [0, 2, 0],
  counterweights: [
    [8, 4, 0],
    [8, 4, 2],
    [12, 4, 0],
    [12, 4, 2],
  ],
  members: [
    // The minimal crane's tower: legs, the braced flange square, side diagonals.
    [[0, 0, 0], [0, 2, 0], "strut"],
    [[2, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 2], [0, 2, 2], "strut"],
    [[2, 0, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 0], "strut"],
    [[0, 2, 2], [2, 2, 2], "strut"],
    [[0, 2, 0], [0, 2, 2], "strut"],
    [[2, 2, 0], [2, 2, 2], "strut"],
    [[0, 2, 0], [2, 2, 2], "strut"],
    [[0, 0, 0], [2, 2, 0], "strut"],
    [[0, 0, 0], [0, 2, 2], "strut"],
    [[2, 0, 0], [2, 2, 2], "strut"],
    [[0, 0, 2], [2, 2, 2], "strut"],
    // The mast, tied to all four top-flange nodes.
    [[0, 4, 0], [0, 8, 0], "strut"],
    [[2, 4, 0], [0, 8, 0], "strut"],
    [[0, 4, 2], [0, 8, 0], "strut"],
    [[2, 4, 2], [0, 8, 0], "strut"],
    // The boom's two chords, the outermost bay of the near one being the track.
    [[0, 4, 0], [4, 4, 0], "strut"],
    [[4, 4, 0], [8, 4, 0], "strut"],
    [[8, 4, 0], [12, 4, 0], "rail"],
    [[0, 4, 2], [4, 4, 2], "strut"],
    [[4, 4, 2], [8, 4, 2], "strut"],
    [[8, 4, 2], [12, 4, 2], "strut"],
    // The cross members and the plan diagonals that make the deck rigid.
    [[4, 4, 0], [4, 4, 2], "strut"],
    [[8, 4, 0], [8, 4, 2], "strut"],
    [[12, 4, 0], [12, 4, 2], "strut"],
    [[0, 4, 2], [4, 4, 0], "strut"],
    [[0, 4, 0], [4, 4, 2], "strut"],
    [[4, 4, 2], [8, 4, 0], "strut"],
    [[4, 4, 0], [8, 4, 2], "strut"],
    [[8, 4, 2], [12, 4, 0], "strut"],
    [[8, 4, 0], [12, 4, 2], "strut"],
    // The mast cables that hold each outboard node up.
    [[0, 8, 0], [4, 4, 0], "cable"],
    [[0, 8, 0], [4, 4, 2], "cable"],
    [[0, 8, 0], [8, 4, 0], "cable"],
    [[0, 8, 0], [8, 4, 2], "cable"],
    [[0, 8, 0], [12, 4, 0], "cable"],
    [[0, 8, 0], [12, 4, 2], "cable"],
  ] as readonly DesignMember[],
  tape: [],
};

/** A move that keeps the run alive and applies no force to the structure. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 100_000, rate: GRIP_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("sounds the collapse cue when a run fails as ring-overload", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await poseCrane(h, OUTRIGGER);
  await poseTape(h, TAPE);

  const ready = await h.check();
  assertTrue(
    ready.stable,
    "the outrigger standing under the editor's static check, so the arm " +
      "solve the ring check reads its reactions from is regular rather than " +
      "singular (specs/statics.md)",
  );

  await startRun(h);
  await h.cues(); // the start's own `run-start`, drained
  const failed = await runTicks(h, 1);
  const played = await h.cues();
  await h.capture("state", "the run screen on the tick the slew ring gave way");

  assertEqual(
    failed.run.cause,
    "ring-overload",
    `the cause the run failed with: a ring connection carrying more than ` +
      `RING_CAP (${RING_CAP}) ends the run as \`ring-overload\` ` +
      "(specs/statics.md)",
  );
  assertContains(
    played,
    "collapse",
    "the cues that tick sounded: `collapse` plays when a run fails as " +
      "`collapse` OR as `ring-overload` (specs/ui.md § Audio)",
  );
});
