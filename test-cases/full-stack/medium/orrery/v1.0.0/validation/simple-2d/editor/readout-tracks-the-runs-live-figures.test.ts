// editor/readout-tracks-the-runs-live-figures — the readout draws the five live
// figures `specs/editor.md` names, rather than resting.
//
// THE RULE. "During a run the readout shows at least the status, the cycle count,
// the period, the speed step, and each set's tally against the challenge's
// `target`; while editing it may rest" (`specs/editor.md`, Layout). The readout's
// extent is the same file's layout table: "`x` `READOUT_X0` (`1008`) to `STAGE_W`
// (`1280`), `y` `HEADING_H` (`48`) to `TAPE_Y0` (`560`)", and its internal layout
// is the build's, so what the specification fixes is that the five figures reach
// that rectangle — not where in it, or in what words.
//
// HOW A FIGURE IS READ WITHOUT READING THE LAYOUT. Five times over, the run is
// posed so that exactly ONE of the five changes and nothing else does, a frame is
// drawn, and the readout's rectangle is compared against the rectangle the frame
// before it left. A readout that shows a figure cannot draw the same rectangle on
// both sides of a change to it; a readout that rests draws the same rectangle
// throughout.
//
// THE CONFIGURATION. `BARE` with the machine every run of it needs — the rise for
// its one reagent, the set for its one product, and one arm whose tape is a single
// `rotate-cw`, so the period starts at `1`. The run opens at speed step `0`, the
// completion switch off, and the field emptied, and one frame is drawn while it is
// `running`. Every change after that is made while the run is PAUSED, so the
// clock adds nothing of its own between two frames and the fraction, the motes and
// the poses stand exactly as they were: the run is paused (status), then
// `setCycle` (cycle), then `setSpeed` (speed step), then `setTally` (tally), then
// one more cell written onto the arm's tape (period). Each is one operation of
// `specs/instrumentation.md` setting one field.
//
// THE VERDICT. Each of the five frames differs from the frame before it inside the
// readout's rectangle, and the snapshot confirms that the figure each step posed
// really moved.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { READOUT_REGION } from "../field";
import { armPart, risePart, setPart, solution } from "../formats";
import { BARE, EAST, ORIGIN, WEST } from "../fixtures";
import {
  captureStill,
  createHarness,
  openBareRun,
  partIds,
  pixelsDiffering,
  type Harness,
  type PixelRect,
} from "../harness";

/** The run opens at the slowest step, and the speed change moves it to the fastest. */
const OPENING_SPEED = 0;
const CHANGED_SPEED = 3;

/** The cycle count the run is moved to, and the tally the one product is given. */
const CHANGED_CYCLE = 5;
const CHANGED_TALLY = 3;

/** The tape length the arm ends at, which is the machine's period. */
const CHANGED_PERIOD = 4;

/** The machine: the rise and set `BARE` needs, and one arm with a one-cell tape. */
const MACHINE = solution([
  risePart(0, WEST.q, WEST.r),
  setPart(0, EAST.q, EAST.r),
  armPart("arm", ORIGIN.q, ORIGIN.r, 0, 1, ["rotate-cw"]),
]);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

function readReadout(): Promise<PixelRect> {
  return h.pixelRect(
    READOUT_REGION.x,
    READOUT_REGION.y,
    READOUT_REGION.w,
    READOUT_REGION.h,
  );
}

it("draws the readout differently for each of the five figures it shows", async () => {
  await openBareRun(h, {
    challenge: BARE,
    machine: MACHINE,
    speed: OPENING_SPEED,
  });
  const arm = (await partIds(h))[2] ?? -1;

  const frames: PixelRect[] = [];
  const posed: { label: string; figure: unknown; wanted: unknown }[] = [];

  await h.advance(1);
  frames.push(await readReadout());
  const opened = await h.snapshot();
  posed.push({
    label: "the run opens running",
    figure: opened.sim?.status,
    wanted: "running",
  });

  await h.debug.setPaused(true);
  await h.advance(1);
  frames.push(await readReadout());
  posed.push({
    label: "sim.status",
    figure: (await h.snapshot()).sim?.status,
    wanted: "paused",
  });

  await h.debug.setCycle(CHANGED_CYCLE);
  await h.advance(1);
  frames.push(await readReadout());
  posed.push({
    label: "sim.cycle",
    figure: (await h.snapshot()).sim?.cycle,
    wanted: CHANGED_CYCLE,
  });

  await h.debug.setSpeed(CHANGED_SPEED);
  await h.advance(1);
  frames.push(await readReadout());
  posed.push({
    label: "sim.speed",
    figure: (await h.snapshot()).sim?.speed,
    wanted: CHANGED_SPEED,
  });

  await h.debug.setTally(0, CHANGED_TALLY);
  await h.advance(1);
  frames.push(await readReadout());
  posed.push({
    label: "the set's tally",
    figure: (await h.snapshot()).sim?.tallies[0],
    wanted: CHANGED_TALLY,
  });

  await h.debug.setTapeCell(arm, CHANGED_PERIOD - 1, "rotate-cw");
  await h.advance(1);
  frames.push(await readReadout());
  posed.push({
    label: "editor.period",
    figure: (await h.snapshot()).editor.period,
    wanted: CHANGED_PERIOD,
  });

  await captureStill(h, "readout");

  for (const step of posed) {
    assertEqual(
      step.figure,
      step.wanted,
      `${step.label} is what this step posed, so the frames either side of it differ in that figure alone`,
    );
  }

  for (const [step, entry] of posed.slice(1).entries()) {
    assertGreaterThan(
      pixelsDiffering(frames[step] as PixelRect, frames[step + 1] as PixelRect),
      0,
      `the readout is drawn differently once ${entry.label} changes, so it shows that figure rather than resting`,
    );
  }
});
