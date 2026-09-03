// collisions/member-sweeps-into-an-obstacle — a member that sweeps into an
// obstacle ends the run.
//
// specs/statics.md § Collisions: "A member whose segment reaches inside an
// obstacle ends the run as `structure-struck-obstacle`. Members standing clear at
// build time can sweep into an obstacle as the arm turns; the test catches them
// tick by tick."
//
// THE BLOCK STANDS WHERE THE ARM IS GOING AND NOT WHERE IT IS. Every node of the
// minimal crane stands at `z <= 2`, and the block spans `x 1..3`, `y 3..5`,
// `z 3..5`, so at the run's starting `slew` of `0` (specs/program.md) nothing is
// within a unit of it — which the first tick of the run is read to confirm,
// because a member already inside at build time would decide a different point.
// The arm turns about the slew axis through `(1, ., 1)` (specs/structure.md § The
// slew ring), and the rail tip at `(4, 4, 0)` is `sqrt(10)` from that axis, so a
// quarter turn carries it to `(2, 4, 4)` — through the middle of the block, with
// the rail and the two ties that reach the tip carried through it on the way.
//
// THE TAPE IS ONE SLEW COMMAND, which is the whole of what this needs: a quarter
// turn at SLEW_MAX_RATE is about three and a half seconds, and the sweep is
// driven a tick at a time until the run ends, so a build that never notices runs
// its tape out and ends with no cause at all — which is the failure this check
// wants to report, rather than a timeout.
//
// AND THE YARD CARRIES NOTHING ELSE: no load to strike anything, and the bare
// hook stays two units below a pivot that never drops below `y = 4`, so the only
// body that can reach the block is a member.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  addOneObstacle,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The block in the arm's path, clear of every member at slew 0. */
const BLOCK_MIN = { x: 1, y: 3, z: 3 } as const;
const BLOCK_SIZE = { x: 2, y: 2, z: 2 } as const;

/** A quarter turn: the tip's path crosses the block well inside it. */
const SWEEP: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
  },
];

/** Ticks the sweep is given: a quarter turn at SLEW_MAX_RATE and its ramps. */
const CAP = 400;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("ends the run as structure-struck-obstacle when a slewing member reaches inside one", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, SWEEP);
  await startRun(h);

  // The guard: the crane stands CLEAR of the block at the posture the run starts
  // from, so what ends the run below is the sweep and not the build.
  const first = await runTicks(h, 1);
  assertEqual(
    first.run.phase,
    "running",
    "the run on its first tick, with the whole crane at z <= 2 and the block " +
      `at z ${BLOCK_MIN.z}..${BLOCK_MIN.z + BLOCK_SIZE.z} (specs/statics.md)`,
  );

  const s = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    CAP,
    "the run to end as the arm sweeps its quarter turn into the block",
  );
  await h.capture("swept", "The arm swept into the block");

  assertEqual(
    s.run.cause,
    "structure-struck-obstacle",
    "the cause of a run ended by a member sweeping inside an obstacle, at " +
      `slew ${s.run.axes.slew.value.toFixed(2)} degrees (specs/statics.md)`,
  );
  assertEqual(
    s.run.phase,
    "failed",
    "the run once a member has swept inside the block",
  );
});
