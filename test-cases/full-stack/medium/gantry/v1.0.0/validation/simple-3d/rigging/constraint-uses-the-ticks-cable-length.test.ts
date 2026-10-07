// rigging/constraint-uses-the-ticks-cable-length — the sphere the bob is held on
// is the one the hoist leaves at the END of the tick's own axis motion.
//
// `specs/rigging.md` § The pendulum tick names "the tick's cable length `L`", and
// `specs/program.md` § The tick pipeline puts axis motion at stage 2 and the
// rigging at stage 4, so `L` is the hoist axis's value AFTER that tick moved it.
// A hoist move therefore draws the bob in, or lets it out, by exactly the distance
// the axis covered on that tick, with no tick of lag.
//
// THE READING IS TAKEN AT EVERY TICK OF A REAL HOIST MOVE, against the hoist value
// the same snapshot reports. That is what separates this tick's length from the
// previous tick's: while the move runs, the axis covers up to
// `HOIST_MAX_RATE * dt` (`0.067`) in a tick, so a build that constrained the bob
// to the length it had at the top of the tick stands tens of thousands of
// tolerances away, and the sampling below insists on that gap being present on
// EVERY tick it reads.
//
// THE MOVE'S FIRST TICKS ARE DRIVEN THROUGH RATHER THAN SAMPLED. A move starts
// from rest and accelerates at `HOIST_ACCEL` (`6`), so its opening ticks cover
// less than the gap that discriminates. Those ticks decide nothing here, so they
// are advanced in one block; the sampling starts once the axis is at a rate that
// separates this tick's cable length from the last's, and every sampled tick then
// has to show it.
//
// THE MOVE PAYS THE CABLE OUT, from `HOIST_START` (`2`) toward `3.5`, and stops
// short of the move's end so every sampled tick is one the axis is moving on. The
// minimal crane's pivot stands at `y = 4`, so the bob hangs no lower than `0.5`:
// clear of the ground, which would end the run for a reason this requirement is
// not about (`specs/statics.md`).

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { HOIST_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  distance3,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One hoist move, paying out, well clear of the ground below the pivot. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: 3.5, rate: HOIST_MAX_RATE }],
  },
];

/**
 * Ticks driven, unsampled, to get the axis out of its opening ramp.
 *
 * `specs/program.md` accelerates an axis at `HOIST_ACCEL` (`6`) per second, so
 * after fifteen ticks the hoist runs at `1.5` units a second and every tick from
 * here covers at least `0.025` — two and a half times `STEP`, whichever order a
 * build updates the rate and the value in.
 */
const RAMP = 15;

/** Ticks sampled one at a time, all of them inside the move, which takes 60. */
const TICKS = 12;

/** A tick of hoist motion worth telling apart from a tick of none. */
const STEP = 0.01;

/** Arithmetic slack on a length the specification fixes exactly. */
const TOLERANCE = 1e-6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("holds the bob at the hoist value that tick's own motion left", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const ramped = await runTicks(h, RAMP);
  assertEqual(
    ramped.run.phase,
    "running",
    `the run after ${RAMP} ticks of the hoist move the sampling reads`,
  );

  let previous = ramped.run.axes.hoist.value;
  let moved = 0;
  for (let tick = 1; tick <= TICKS; tick += 1) {
    const { run } = await runTicks(h, 1);
    const L = run.axes.hoist.value;
    if (Math.abs(L - previous) >= STEP) moved += 1;
    previous = L;
    assertNear(
      distance3(run.pivot, run.bob.pos),
      L,
      TOLERANCE,
      `tick ${tick}: the distance from the pivot to the bob, which the ` +
        `constraint holds at that tick's own cable length ${L.toFixed(4)} ` +
        "(specs/rigging.md)",
    );
  }

  await h.capture("hoist", "The bob drawn in through a hoist move");

  assertEqual(
    moved,
    TICKS,
    `the sampled ticks that moved the hoist by at least ${STEP}, on which ` +
      "this tick's cable length and the tick before's differ by far more " +
      "than the tolerance (specs/program.md)",
  );
});
