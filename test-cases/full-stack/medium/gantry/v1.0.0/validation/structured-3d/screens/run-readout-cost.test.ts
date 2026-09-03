// run/readouts — the run screen shows the cost of the crane the run is made with.
//
// `specs/ui.md` § Run lists "The run clock, in seconds, and the crane's cost"
// among the run screen's readouts. The cost itself is the structure's
// (`specs/structure.md`), and `specs/state.md` has it derived from
// `sites[siteIndex].structure`, so the figure this check looks for is the one the
// build's own snapshot reports as `structure.cost` — the readout is graded
// against the crane on the site rather than against a number this file chose.
//
// THE CRANE IS THE MINIMAL ONE, whose cost is a three-figure number no other
// readout on the run screen carries: the clock is a fraction of a second at the
// tick this reads, the step counter is `1 / 1`, the site is `1 / 6`, and the four
// axes are at the run-start posture.
//
// THE TOLERANCE IS A WHOLE UNIT, because `specs/ui.md` fixes that the cost is
// shown and not how it is written: a build rounding the cost to whole force-free
// units is writing the same figure.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertGreaterThan, assertTrue, fail } from "../assert";
import { SLEW_MAX_RATE } from "../constants";
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

/** Something for the run to be doing while the cost is read. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "slew", target: 253, rate: SLEW_MAX_RATE }],
  },
];

/** A whole force-free unit: the coarsest rounding a build could write. */
const FIGURE_TOL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** Every run of text the frame the page last drew put on its readout layer. */
async function readoutText(harness: Harness): Promise<string[]> {
  const ops = (await harness.screenOps()) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** Every number a run of text carries, group separators closed up first. */
function numbersIn(text: string): number[] {
  const joined = text.replace(/(?<=\d)[\s,](?=\d)/g, "");
  return (joined.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

it("draws the crane's cost on the run screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);
  const state = await runTicks(h, 1);

  assertTrue(
    state.screen === "run" && state.run.phase === "running",
    "the run screen showing a run in progress, so its readouts are the ones " +
      `specs/ui.md lists (screen "${state.screen}", run "${state.run.phase}")`,
  );
  const cost = state.structure.cost;
  assertGreaterThan(
    cost,
    0,
    "the cost of the crane the run is being made with (specs/structure.md)",
  );

  const drawn = await readoutText(h);
  const shown = drawn.some((text) =>
    numbersIn(text).some((figure) => Math.abs(figure - cost) <= FIGURE_TOL),
  );
  if (!shown) {
    fail(
      `the crane's cost, ${cost.toFixed(2)}, drawn on the run screen ` +
        "(specs/ui.md)",
      `the screen's text reads [${drawn.map((one) => one.trim()).join(" | ")}]`,
    );
  }

  await h.capture("run-cost", "The cost readout on the run screen");
});
