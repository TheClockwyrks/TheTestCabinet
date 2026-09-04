// run/readouts — the run screen shows the watch speed it is holding.
//
// `specs/ui.md` § Run lists among the run screen's readouts "The watch speed,
// cycled by `speed` through `RUN_SPEEDS` (`specs/program.md`): each press takes
// the next index and wraps from the last back to the first, so a run started at
// index `0` reads `1`, `2`, `4` across four presses." This check decides that
// the readout is there and reads the entry of `RUN_SPEEDS` the run's speed index
// names. Which key cycles it, and the wrap, belong to the `speed` action and are
// checked with it; here the index is posed.
//
// THE SPEED IS POSED WITH `setSpeedIndex` ON A RUN THAT HAS ENDED, which
// `specs/instrumentation.md` states in as many words: it "poses the watch speed
// on the run screen, as the `speed` action does, whether or not the run that
// screen is showing has ended". A failed run stays on the run screen with its
// readouts (`specs/ui.md`), and — this is why the scenario is worth the extra
// step — its clock, its axes and its step counter are all frozen. So the ONLY
// thing that can change between two frames is the speed readout, and the check
// reads the figure off the change rather than off the whole screen: at index `0`
// a `1` is drawn that is gone at index `1`, and so on up the table. A screen
// carrying no speed readout at all cannot pass that by drawing a `1` somewhere
// else, which is the whole difficulty with a figure as ordinary as `1`.
//
// THE RUN IS FAILED BY A TAPE COMMANDING THE HOIST PAST `HOIST_MAX`, which
// `specs/program.md` ends as `command-out-of-range` on the tick the step starts:
// one tick, no rigging, no loads, no collisions.

import { afterEach, beforeEach, it } from "vitest";

import { drawnText, toDrawCall } from "../case-harness/index";
import { assertEqual, assertTrue, fail } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE, RUN_SPEEDS } from "../constants";
import {
  createHarness,
  emptyYard,
  openSite,
  poseTape,
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** A hoist target past `HOIST_MAX`, so the first tick ends the run. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "hoist", target: HOIST_MAX + 60, rate: HOIST_MAX_RATE }],
  },
];

/** Ticks the run is given to reach its verdict: the first tick takes the step. */
const END_CAP = 4;

/** How far a drawn figure may sit from the speed it reads. */
const FIGURE_TOL = 0.05;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every run of text the frame the page last drew put on its readout layer. */
async function readoutText(harness: Harness): Promise<string[]> {
  const ops = await harness.screenOps();
  return drawnText(ops.map(toDrawCall));
}

/** Every number a run of text carries, group separators closed up first. */
function numbersIn(text: string): number[] {
  const joined = text.replace(/(?<=\d)[\s,](?=\d)/g, "");
  return (joined.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

it("draws the RUN_SPEEDS entry the run's speed index names", async () => {
  await openSite(h, 0);
  // The YARD alone, rather than the whole world: the crane pose below empties
  // the structure itself, and a site opens with an empty tape
  // (`specs/state.md`), so there is nothing else here to clear.
  await emptyYard(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the out-of-range command to end the run",
  );
  assertTrue(
    ended.screen === "run" && ended.run.phase === "failed",
    "a failed run held on the run screen, so its readouts are still the run " +
      `screen's (screen "${ended.screen}", run "${ended.run.phase}")`,
  );

  // One frame per index, in order, with the frame each index was drawn on kept.
  const frames: string[][] = [];
  for (const [index] of RUN_SPEEDS.entries()) {
    await h.debug.setSpeedIndex(index);
    // The frame and the reading in one crossing: `runTicks` answers with the
    // state the ticks it drove left (`validation/harness.ts`).
    const drawn = await runTicks(h, 1);
    assertEqual(
      drawn.run.speedIndex,
      index,
      `the speed index the run is holding (specs/instrumentation.md)`,
    );
    frames.push(await readoutText(h));
  }

  for (const [index, speed] of RUN_SPEEDS.entries()) {
    const other = frames[index === 0 ? 1 : index - 1] as string[];
    const mine = frames[index] as string[];
    const only = mine.filter((text) => !other.includes(text));
    const shown = only.some((text) =>
      numbersIn(text).some((figure) => Math.abs(figure - speed) <= FIGURE_TOL),
    );
    if (!shown) {
      fail(
        `the watch speed ${speed}, the RUN_SPEEDS entry index ${index} names, ` +
          "drawn on the run screen and nowhere in the frame the neighboring " +
          "index draws (specs/ui.md)",
        `the frame at index ${index} draws [${mine
          .map((one) => one.trim())
          .join(" | ")}], of which only [${only
          .map((one) => one.trim())
          .join(" | ")}] is its own`,
      );
    }
  }

  await h.capture("run-speed", "The watch-speed readout");
});
