// results — the results screen draws `CLEARED_TEXT`.
//
// `specs/ui.md` § Results: "`results` shows `CLEARED_TEXT` (`SITE CLEARED`), the
// run's cost and time beside the site's par cost and par time
// (`specs/sites.md`), and the menu `RESULTS_ITEMS`". This check decides the
// first of those: the fixed copy is on the screen. The scores and the menu are
// their own points.
//
// THE SCREEN IS REACHED BY CLEARING A SITE rather than by posing it.
// `specs/ui.md` puts the results screen at the end of a cleared run — "A cleared
// run moves to `results`" — and `specs/instrumentation.md` warns that
// `setScreen` "shows the screen and sets nothing else", while "a cleared run
// records its score on the way to `results`". So the run is run.
//
// THE YARD IS EMPTY, which is what makes the run cheap and the scenario
// isolated: `specs/program.md` clears a run when the tape runs out and "every
// load is `placed`", and a yard holding no load meets that on the tick the one
// step completes. Nothing about the copy under test depends on there being a
// load to deliver.
//
// THE MATCH IS BY SUBSTRING, IGNORING CASE. `specs/ui.md` fixes the words and
// leaves their presentation to the build, so a build is free to letter-space or
// decorate the line around them.

import { afterEach, beforeEach, it } from "vitest";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertEqual, fail } from "../assert";
import { CLEARED_TEXT, GRIP_MAX_RATE } from "../constants";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";

/** One short move: enough for a tape to run out and clear an empty yard. */
const TAPE: readonly TapeStepSpec[] = [
  {
    kind: "move",
    commands: [{ axis: "grip", target: 30, rate: GRIP_MAX_RATE }],
  },
];

/** Ticks the run is given to reach its verdict. */
const END_CAP = 600;

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

it("draws CLEARED_TEXT on the results screen", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, TAPE);
  await startRun(h);

  const ended = await runUntil(
    h,
    (snapshot) => snapshot.run.phase !== "running",
    END_CAP,
    "the tape to run out and the site to clear",
  );
  assertEqual(
    ended.run.phase,
    "cleared",
    "the verdict a tape that runs out with every load placed reaches " +
      "(specs/program.md)",
  );
  assertEqual(
    ended.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );

  await h.advance(1);
  const drawn = await readoutText(h);
  const wanted = CLEARED_TEXT.toLowerCase();
  if (!drawn.some((text) => text.toLowerCase().includes(wanted))) {
    fail(
      `CLEARED_TEXT ("${CLEARED_TEXT}") drawn on the results screen ` +
        "(specs/ui.md)",
      `the screen's text reads [${drawn.map((one) => one.trim()).join(" | ")}]`,
    );
  }

  await h.capture("results-copy", "The cleared copy");
});
