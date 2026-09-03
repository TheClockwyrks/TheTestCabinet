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
// unit and not the number of places, so a build is free to write `7`, `7.0` or
// `0:07`; at exactly `CLOCK_TICKS` (`7` seconds of run clock) all three carry the
// same figure, and no rounding a build could choose changes it. The run itself is
// one long slew, so no other readout on the screen carries a `7`: the cost is the
// minimal crane's, the step counter is `1 / 1`, the site is `1 / 6`, and the four
// axes are nowhere near it.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall } from "../case-harness/index";
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

/** Seven seconds of run clock, in the ticks `specs/program.md` counts them in. */
const CLOCK_SECONDS = 7;
const CLOCK_TICKS = CLOCK_SECONDS * TICK_HZ;

/** A slew long enough to still be running when the clock reads seven. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 253, rate: SLEW_MAX_RATE }] },
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

/** Every run of text the frame the build last drew put on its readout layer. */
async function readoutText(harness: Harness): Promise<string[]> {
  return drawnText((await harness.screenOps()).map(toDrawCall));
}

/** Every number a run of text carries, group separators closed up first. */
function numbersIn(text: string): number[] {
  const joined = text.replace(/(?<=\d)[\s,](?=\d)/g, "");
  return (joined.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
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

  const drawn = await readoutText(h);
  const shown = drawn.some((text) =>
    numbersIn(text).some(
      (figure) => Math.abs(figure - CLOCK_SECONDS) <= FIGURE_TOL,
    ),
  );
  if (!shown) {
    fail(
      `the run clock, ${CLOCK_SECONDS} seconds, drawn on the run screen ` +
        "(specs/ui.md)",
      `the screen's text reads [${drawn.map((one) => one.trim()).join(" | ")}]`,
    );
  }

  await h.capture("run-clock", "The run clock");
});
