// audio/fail-cue-on-every-failure — every failed run sounds the fail cue.
//
// specs/ui.md § Audio: "`fail` | a run fails, whatever the cause". The cue is
// raised by the FAILURE and not by any one way of failing, so a build that wired
// it to the collapse it also sounds `collapse` for, or to the failures the run
// screen has copy for, leaves some run ending in silence. specs/statics.md
// collects the whole vocabulary of causes.
//
// THREE RUNS, THREE CAUSES, EACH REACHED FOR A DIFFERENT REASON:
//
//   - `collapse`, from the solve. The minimal crane with the four diagonals that
//     brace its tower's sides taken away is still READY — it has its ring, its
//     rail and no disconnected member (specs/structure.md) — so the run starts,
//     and the tower is a mechanism, so the first tick's solve goes singular
//     (specs/statics.md).
//   - `cable-snap`, from the rigging, which is a different stage of the tick
//     pipeline (specs/program.md) and a failure the structure has no part in.
//     Three hundred units hung on the hook make the bob's mass `HOOK_MASS` plus
//     three hundred, and a bob hanging at rest pulls `m * GRAVITY` (`3050`) —
//     past `HOIST_CABLE_CAP` (`3000`), which "snaps the cable and ends the run as
//     `cable-snap`" (specs/rigging.md).
//   - `loads-unplaced`, from the tape, which is not a mishap at all: the yard's
//     crate is never lifted, so "a tick that finds no live step and no step left
//     to take is the tick the run ends on: cleared if every load is `placed`,
//     otherwise failed as `loads-unplaced`" (specs/program.md).
//
// Each run is driven ONE TICK AT A TIME with the queue drained on every one of
// them, so what is read is the cues of the failing tick itself and of no other.
//
// SO EACH RUN IS POSED TO END WITHIN A FEW TICKS OF ITS START. The tick a run
// fails on is the only tick any of these three readings looks at, and the ticks
// before it are only there to be a run in progress. The collapse and the snap
// arrive on their own; what is chosen is the tape, which turns the grip half a
// degree — some nine ticks under `GRIP_ACCEL` — so the third run's tape RUNS OUT
// in nine ticks instead of the thirty a hoist move takes, and the cable-snap run
// hangs its load on the first tick rather than the fifth.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual } from "../assert";
import { GRIP_MAX_RATE, HOIST_MAX_RATE } from "../constants";
import {
  MINIMAL_CRANE,
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseCrane,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type CraneDesign,
  type FailCause,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The four members that brace the minimal crane's tower out of plane. */
const SIDE_BRACES = new Set([
  "0,0,0|2,2,0",
  "0,0,0|0,2,2",
  "2,0,0|2,2,2",
  "0,0,2|2,2,2",
]);

/** The minimal crane with its tower left a mechanism: ready, and it cannot stand. */
const MECHANISM: CraneDesign = {
  ...MINIMAL_CRANE,
  name: "Unbraced tower",
  members: MINIMAL_CRANE.members.filter(
    ([a, b]) => !SIDE_BRACES.has(`${a.join(",")}|${b.join(",")}`),
  ),
};

/**
 * A tape that moves one axis a short way, so a run is a run — and runs out fast.
 *
 * Half a degree of grip under `GRIP_ACCEL` (`90`) is a ramp up and straight back
 * down in `2 * sqrt(0.5 / 90)` seconds, some nine ticks. "Turning the grip
 * applies no force to anything" (specs/rigging.md), so the run it makes is one
 * whose ending is decided by what this point poses and by nothing the tape did.
 */
const SHORT_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 0.5, rate: GRIP_MAX_RATE }],
  },
];

/** A tape long enough to still be running when something else ends the run. */
const LONG_TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 20, rate: HOIST_MAX_RATE }],
  },
];

/** What a failing tick left, and what it sounded. */
interface Ending {
  snapshot: GantrySnapshot;
  cues: string[];
}

/**
 * Tick until the run ends, draining the cue queue on every tick.
 *
 * The cues that come back are the FAILING tick's alone. It fails the check on its
 * cap rather than falling through to an assertion about a run still going.
 */
async function runToTheEnd(
  harness: Harness,
  maxTicks: number,
  what: string,
): Promise<Ending> {
  for (let tick = 1; tick <= maxTicks; tick += 1) {
    const snapshot = await runTicks(harness, 1);
    const cues = await harness.cues();
    if (snapshot.run.phase !== "running") return { snapshot, cues };
  }
  const held = await harness.snapshot();
  assertEqual(
    held.run.phase,
    "failed",
    `${what} within ${maxTicks} ticks, so there is a failing tick to read`,
  );
  return { snapshot: held, cues: [] };
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the fail cue on the failing tick of a run, whatever the cause", async () => {
  const failures: { cause: FailCause; cues: string[] }[] = [];

  // A solve going singular.
  await openSite(h, 0);
  await clearAll(h);
  await poseCrane(h, MECHANISM);
  await poseTape(h, SHORT_TAPE);
  await startRun(h);
  await h.cues();
  const collapse = await runToTheEnd(h, 20, "the unbraced tower to collapse");
  assertEqual(collapse.snapshot.run.cause, "collapse", "the first run's cause");
  failures.push({ cause: "collapse", cues: collapse.cues });

  // The hoist cable pulled past its cap.
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    300,
    { x: 9, y: 2, z: 6, yaw: 0 },
    { x: 9, y: 2, z: 6, yaw: 0 },
  );
  await poseTape(h, LONG_TAPE);
  await startRun(h);
  await runTicks(h, 1);
  await h.cues();
  await h.debug.setLoadPhase(0, "attached");
  const snap = await runToTheEnd(h, 20, "the hoist cable to snap");
  assertEqual(snap.snapshot.run.cause, "cable-snap", "the second run's cause");
  failures.push({ cause: "cable-snap", cues: snap.cues });

  // A tape that ran out with the yard's load still standing where it began.
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(
    h,
    "crate",
    40,
    { x: 9, y: 2, z: 6, yaw: 0 },
    { x: 9, y: 2, z: 6, yaw: 0 },
  );
  await poseTape(h, SHORT_TAPE);
  await startRun(h);
  await h.cues();
  const unplaced = await runToTheEnd(h, 40, "the tape to run out");
  await h.capture("failures", "The last of the three failures");

  assertEqual(
    unplaced.snapshot.run.cause,
    "loads-unplaced",
    "the third run's cause",
  );
  failures.push({ cause: "loads-unplaced", cues: unplaced.cues });

  for (const { cause, cues } of failures) {
    assertContains(
      cues,
      "fail",
      `the cue the tick a run failed as \`${cause}\` plays: a run fails, ` +
        "whatever the cause (specs/ui.md)",
    );
  }
});
