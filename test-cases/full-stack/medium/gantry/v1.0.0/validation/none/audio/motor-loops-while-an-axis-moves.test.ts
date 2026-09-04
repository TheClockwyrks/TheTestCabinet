// audio/motor-loops-while-an-axis-moves — the motor loop runs while an axis is
// turning.
//
// specs/ui.md § Audio: "| `motor` | loops while a run is in progress and any
// axis's rate is nonzero, and is silent otherwise …", and the paragraph under
// the table adds "`motor` is the one loop". This point is that row's first half:
// a run in progress with an axis moving is sounding.
//
// THE AXIS IS THE SLEW, DRIVEN BY THE TAPE. The tape is one move that turns the
// arm a long way at `SLEW_MAX_RATE`, so the axis is still accelerating toward
// its commanded rate when the reading is taken, well short of its target: the
// controller of specs/program.md is driving rather than arriving, and the run's
// own `axes.slew.rate` is read back to say so before the sound is judged. The
// yard is emptied and the crane is the minimal one, because nothing here is
// about the crane, the load, or the site.
//
// THE READING TAKES BOTH HALVES OF THE BUS. specs/assets.md leaves a build free
// to make the loop seamless either by looping one decoded source or by
// re-scheduling it end to end, so the harness answers "is the loop running" from
// the sources that are looping right now and from the ones that started since the
// last read together. The queue is drained a few ticks into the motion first, so
// what is read back is the loop still running rather than the start it made when
// the arm first moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertContains, assertEqual, assertNotEqual } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** The site this runs on; the motor is the run's, not the site's. */
const SITE = 0;

/** One long slew: the arm is still turning wherever the reading is taken. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 720, rate: SLEW_MAX_RATE }],
  },
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("runs the motor loop while a run's axis rate is nonzero", async () => {
  await openSite(h, SITE);
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);

  await startRun(h);
  await runTicks(h, 3);
  await h.cues(); // the start's cues and the loop's own opening start, drained

  const turning = await runTicks(h, 5);
  const sounding = [...(await h.loopingCues()), ...(await h.cues())];
  await h.capture("state", "the arm turning under the tape's slew move");

  assertEqual(
    turning.run.phase,
    "running",
    "the run while the reading is taken: the motor's row asks for a run in " +
      "progress (specs/ui.md § Audio)",
  );
  assertNotEqual(
    turning.run.axes.slew.rate,
    0,
    "the slew's rate while the reading is taken: the tape is driving it " +
      "toward a far target, so it is turning (specs/program.md)",
  );
  assertContains(
    sounding,
    "motor",
    "the loop sounding while an axis's rate is nonzero: `motor` loops while " +
      "a run is in progress and any axis's rate is nonzero " +
      "(specs/ui.md § Audio)",
  );
});
