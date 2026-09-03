// rigging/placed-load-stays-put — a placed load sits at exactly its target pose
// for the rest of the run.
//
// specs/rigging.md § Releasing: when the three set-down tests hold "the load is
// `placed`: it leaves the hook, sits at exactly its target pose for the rest of
// the run". Exactly, and for the rest of the run — so a placed load is not a body
// the simulation carries on integrating, not something the arm can nudge, and not
// something that settles toward its pad over a few ticks.
//
// THE ARM IS THEN DRIVEN THROUGH THE SPACE THE LOAD OCCUPIES, which is what makes
// this a reading of "whatever the crane does around it" rather than of a load
// nothing ever came near. The pad is `(3, 4, 0)` at yaw `45`: a crate's lift point
// there puts its box between `y = 2` and `y = 4`, straddling the track the trolley
// runs on, and the tape slews the arm at `SLEW_MAX_RATE` for the whole reading, so
// the rail, the mast ties and the trolley sweep clean through it. specs/statics.md
// § Collisions is what says they may: a placed load is tested against nothing, and
// "The structure never collides with itself or with a load."
//
// THE LOAD IS SET DOWN THROUGH THE SURFACE RATHER THAN BY A `release` STEP, so this
// point is decided by what a PLACED load does and not by whether a release was
// judged correctly. specs/instrumentation.md: `setLoadPhase` to `"placed"` "sets
// the load down exactly as a successful `release` leaves it: it sits at exactly
// its target pose and stays there for the rest of the run". A tape that lifted and
// released the load would fail this item whenever the set-down tolerances were the
// thing that was wrong.
//
// `WATCHED` (`300`) ticks is five seconds of run clock, a hundred and fifty
// degrees of slew, and the tape's move is far from over at the end of it, so the
// run is still running for every one of them.

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
  type Harness,
  type TapeStepSpec,
} from "../harness";

const SITE = 0;

/** Where the load starts: out in the yard, well clear of the crane. */
const FROM = { x: 8, y: 2, z: 0, yaw: 0 };

/** The pad: in the arm's own plane, so the slew sweeps the crane through it. */
const PAD = { x: 3, y: 4, z: 0, yaw: 45 };

/** Ticks the placed load is watched for: five seconds of slewing. */
const WATCHED = 300;

/** A pose reported by assignment; the tolerance is arithmetic noise. */
const TOLERANCE = 1e-9;

/** The turn that drives the arm through the pad, and never finishes. */
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

it("holds a placed load at its target pose while the arm sweeps through it", async () => {
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

  for (let watched = 0; watched < WATCHED; watched += 1) {
    const { run } = await runTicks(h, 1);
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
        `${run.axes.slew.value.toFixed(2)} degrees sweeping through it: a ` +
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
  }

  const swept = await h.snapshot();
  await h.capture("placed", "the crane driven through the placed load");
  assertGreaterThan(
    Math.abs(swept.run.axes.slew.value),
    90,
    `the degrees the arm turned over the ${WATCHED} ticks the load was ` +
      "watched, so the crane genuinely swept through the pad",
  );
});
