// run/readouts — the run screen shows the run clock, in seconds.
//
// `specs/ui.md` § Run lists "The run clock, in seconds, and the crane's cost"
// among the run screen's readouts. `specs/program.md` fixes what the clock reads
// — "the run clock the run ends on is that tick's own number over `TICK_HZ`" —
// and `specs/state.md` says the same of every tick: "The run clock is
// `tick / TICK_HZ` seconds". This check decides that the figure is on screen and
// that it is that figure.
//
// THE READING IS TAKEN AT A WHOLE NUMBER OF SECONDS. `specs/ui.md` fixes the
// unit and not the number of places, so a build is free to write `3`, `3.00` or
// `0:03`; at exactly `CLOCK_TICKS` (`3` seconds of run clock) all three carry the
// same figure, and no rounding a build could choose changes it.
//
// AND `3` IS THE FIRST WHOLE SECOND NO OTHER READOUT CAN CARRY, which is what
// fixes the length of the drive: the reading costs `CLOCK_SECONDS * TICK_HZ`
// ticks and nothing else, so the cheapest honest figure is the smallest safe one.
// `specs/ui.md` § Run puts each of the smaller ones on the screen already —
// `0` is the trolley and the grip at the run-start posture (`specs/program.md`),
// `1` is `step 1 / 1`, the watch speed a run starts at, and the site's number,
// and `2` is `HOIST_START`, the cable length the same posture starts at. Nothing
// on the screen reads `3`: the run is one long slew, so the cost is the minimal
// crane's, the slew is `75` at this tick against a target of `253`, and the other
// three axes are the run-start values above.

import { afterEach, beforeEach, it } from "vitest";
import { drawnFigures, type DrawnFigures } from "./figures";
import { assertEqual, assertTrue, fail } from "../assert";
import { SLEW_MAX_RATE, TICK_HZ } from "../constants";
import {
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

/** Three seconds of run clock, in the ticks `specs/program.md` counts them in. */
const CLOCK_SECONDS = 3;
const CLOCK_TICKS = CLOCK_SECONDS * TICK_HZ;

/** A slew long enough to still be running when the clock reads three. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 253, rate: SLEW_MAX_RATE }],
  },
];

/**
 * How far a drawn figure may sit from the clock it reads.
 *
 * The clock is a whole number of seconds at the tick this reads, so every
 * rounding writes the same figure and the tolerance is only for the decimal
 * places a build chooses to keep.
 */
const FIGURE_TOL = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The figures the last closed frame's text carries, and the runs it spelled.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out
 * in logical stage units" — so what a screen shows is the text that layer's
 * frame issued, whatever font, colour, or arrangement a build chose for it.
 *
 * The figures come from `./figures`, this project's one reading of a number on
 * the screen, and it reads the frame's raw draws and its coalesced logical runs
 * TOGETHER, because neither half alone answers a check like this one. A build
 * that letter-spaces a figure draws a glyph per `fillText` — the only portable
 * way to letter-space canvas text — so its figure exists only once the glyphs
 * are put back together into a run. A build that groups a figure with a space
 * inside ONE call, which is what this case's own reference does, has a figure
 * the runs cannot be read for: the merge writes an ASCII space of its own
 * wherever it crosses a word gap, so a run's spaces are not all the build's and
 * a reading of the runs may not treat one as a separator. `screenCalls` carries
 * the measured geometry that merge needs.
 */
async function readoutFigures(harness: Harness): Promise<DrawnFigures> {
  return drawnFigures(await harness.screenCalls());
}

it("draws the run clock the ticks it has taken make", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const state = await runTicks(h, CLOCK_TICKS);

  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress, so its readouts are the ones " +
      `specs/ui.md lists (screen "${state.screen}", run "${state.run.phase}")`,
  );
  assertEqual(
    state.run.time,
    CLOCK_SECONDS,
    `the run clock after ${CLOCK_TICKS} ticks, tick / TICK_HZ seconds ` +
      "(specs/state.md)",
  );

  const drawn = await readoutFigures(h);
  const shown = drawn.all.some(
    (figure) => Math.abs(figure - CLOCK_SECONDS) <= FIGURE_TOL,
  );
  await h.capture("run-clock", "The run clock");

  if (!shown) {
    fail(
      `the run clock, ${CLOCK_SECONDS} seconds, drawn on the run screen ` +
        "(specs/ui.md)",
      `the screen's text reads ` +
        `[${drawn.runs.map((run) => run.text.trim()).join(" | ")}]`,
    );
  }
});
