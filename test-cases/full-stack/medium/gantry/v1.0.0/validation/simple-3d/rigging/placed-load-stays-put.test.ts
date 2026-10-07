// rigging/placed-load-stays-put — a placed load sits at exactly its target pose
// for the rest of the run.
//
// specs/rigging.md § Releasing: when the three set-down tests hold "the load is
// `placed`: it leaves the hook, sits at exactly its target pose for the rest of
// the run". Exactly, and for the rest of the run — so a placed load is not a body
// the simulation carries on integrating, not something the arm can nudge, and not
// something that settles toward its pad over a few ticks.
//
// THE ARM IS DRIVEN ACROSS THE SPACE THE LOAD OCCUPIES, which is what makes this
// a reading of "whatever the crane does around it" rather than of a load nothing
// ever came near. The pad is `(3, 4, 0)` at yaw `45`, and at slew `0` the minimal
// crane's rail runs from `(0, 4, 0)` to `(4, 4, 0)` — straight through that lift
// point, with the crate's box hanging between `y = 2` and `y = 4` under it. The
// tape then slews at `SLEW_MAX_RATE` and carries the rail, the mast ties and the
// trolley off it. specs/statics.md § Collisions is what says they may: a placed
// load is tested against nothing, and "The structure never collides with itself
// or with a load."
//
// THE LOAD IS SET DOWN THROUGH THE SURFACE RATHER THAN BY A `release` STEP, so this
// point is decided by what a PLACED load does and not by whether a release was
// judged correctly. specs/instrumentation.md: `setLoadPhase` to `"placed"` "sets
// the load down exactly as a successful `release` leaves it: it sits at exactly
// its target pose and stays there for the rest of the run". A tape that lifted and
// released the load would fail this item whenever the set-down tolerances were the
// thing that was wrong.
//
// HOW LONG IT IS WATCHED, AND WHY THAT IS LONG ENOUGH. `WATCHED` (`90`) ticks is a
// second and a half of run clock and `SWEPT` (`25`) degrees of slew or better —
// enough for the arm to travel the width of the crate's footprint and off it,
// which is the whole of what "the crane does around it" amounts to here; the
// tape's move is far from over at the end of it, so the run is still running for
// every one of them. The first `CLOSE` (`12`) ticks are read one at a time,
// because a load that settles toward its pad rather than arriving at it does so
// over the ticks right after the set-down; the rest are read every `STRIDE` (`10`)
// ticks, because the two failures left — a load the simulation carries on
// integrating, and a load the arm nudges — both leave it somewhere other than its
// pad and nothing puts it back.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertEqual,
  assertGreaterThan,
  assertNear,
  assertVec3Near,
} from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  addOneLoad,
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type GantrySnapshot,
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** Where the load starts: out in the yard, well clear of the crane. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };

/** The pad: under the rail at slew `0`, so the arm starts standing on it. */
const PAD = { x: 3, y: 4, z: 0, yaw: 45 };

/** Ticks the placed load is watched for: a second and a half of slewing. */
const WATCHED = 90;

/** Ticks after the set-down that are read one at a time. */
const CLOSE = 12;

/** Ticks between readings over the rest of the watch. */
const STRIDE = 10;

/** Degrees of slew the watch must cover for the arm to have crossed the pad. */
const SWEPT = 25;

/** A pose reported by assignment; the tolerance is arithmetic noise. */
const TOLERANCE = 1e-9;

/** The turn that drives the arm across the pad, and never finishes. */
const SWEEP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 3000, rate: SLEW_MAX_RATE }],
};

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds a placed load at its target pose while the arm sweeps across it", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", 40, FROM, PAD);
  await poseTape(h, [SWEEP]);

  await startRun(h);
  await runTicks(h, 1);
  await h.debug.setLoadPhase(0, "placed");

  const down = await h.snapshot();
  assertEqual(
    down.run.loads[0]?.phase,
    "placed",
    "the load set down on its pad",
  );

  /** One reading of the placed load, wherever in the watch it falls. */
  const readPlaced = (run: GantrySnapshot["run"], watched: number): void => {
    assertEqual(
      run.phase,
      "running",
      `the run on tick ${run.tick}, ${watched} ticks after the load was placed`,
    );
    assertEqual(
      run.loads[0]?.phase,
      "placed",
      `the load's phase on tick ${run.tick}: once placed it stays placed ` +
        "(specs/rigging.md § Releasing)",
    );
    assertVec3Near(
      run.loads[0]?.pos as { x: number; y: number; z: number },
      { x: PAD.x, y: PAD.y, z: PAD.z },
      TOLERANCE,
      `the placed load's lift point on tick ${run.tick}, with the arm at ` +
        `${run.axes.slew.value.toFixed(2)} degrees sweeping across it: a ` +
        "placed load sits at EXACTLY its target position for the rest of the " +
        "run (specs/rigging.md § Releasing)",
    );
    assertNear(
      run.loads[0]?.yaw as number,
      PAD.yaw,
      TOLERANCE,
      `the placed load's yaw on tick ${run.tick}: a placed load sits at ` +
        "exactly its target yaw for the rest of the run " +
        "(specs/rigging.md § Releasing)",
    );
  };

  let watched = 0;
  while (watched < WATCHED) {
    const step = watched < CLOSE ? 1 : Math.min(STRIDE, WATCHED - watched);
    const { run } = await runTicks(h, step);
    watched += step;
    readPlaced(run, watched);
  }

  const swept = await h.snapshot();
  await h.capture("placed", "the crane driven through the placed load");
  assertGreaterThan(
    Math.abs(swept.run.axes.slew.value),
    SWEPT,
    `the degrees the arm turned over the ${WATCHED} ticks the load was ` +
      "watched, so the crane genuinely crossed the pad it was standing on",
  );
});
