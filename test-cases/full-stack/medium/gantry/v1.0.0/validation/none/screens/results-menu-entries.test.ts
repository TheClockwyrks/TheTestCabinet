// results — the results screen offers `RESULTS_ITEMS` in order.
//
// `specs/ui.md` § Results: the screen shows "the menu `RESULTS_ITEMS`
// (`NEXT SITE`, `REPLAY`, `SITE SELECT`), with `menuIndex` `0` on arriving". The
// three entries and their order are this check; where each leads, and the
// highlight on arriving, are their own points.
//
// THE SITE IS SITE `0`, deliberately not the last one: "On the last site
// `NEXT SITE` is left out and the menu is the other two entries in the same
// order", so a check about the three-entry menu has to be on a site that has a
// next one.
//
// THE SCREEN IS REACHED BY CLEARING THE SITE rather than by posing it, because
// `specs/instrumentation.md` has `setScreen` show a screen and set nothing else
// while "a cleared run records its score on the way to `results`".
//
// ORDER IS READ OFF THE FRAME'S OWN LAYOUT: every run of text the frame drew,
// taken top to bottom and left to right, has to carry the three entries in the
// order `RESULTS_ITEMS` lists them. That is one reading whether a build stacks
// the menu down the screen or lays it across, and it never depends on the entries
// being three separate runs of text.

import { afterEach, beforeEach, it } from "vitest";
import { RECORDER_GLOBAL } from "../case-harness/config";
import { textDraws, toDrawCall, type RecordedOp } from "../case-harness/index";
import { assertEqual, fail } from "../assert";
import { GRIP_MAX_RATE, RESULTS_ITEMS } from "../constants";
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
  { kind: "move", commands: [{ axis: "grip", target: 30, rate: GRIP_MAX_RATE }] },
];

/** Ticks the run is given to reach its verdict. */
const END_CAP = 600;

/** Runs of text this far apart in `y` are on one line of the screen. */
const LINE_SLOP = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/** The frame's drawn text, top to bottom and left to right, as one string. */
async function readingOrder(harness: Harness): Promise<string> {
  const ops = (await harness.page.evaluate(
    (global) =>
      (window as unknown as Record<string, { last(): unknown[] }>)[
        global
      ]!.last(),
    RECORDER_GLOBAL,
  )) as RecordedOp[];
  return textDraws(ops.map(toDrawCall))
    .map((draw) => ({ ...draw, line: Math.round(draw.y / LINE_SLOP) }))
    .sort((one, two) => one.line - two.line || one.x - two.x)
    .map((draw) => draw.text)
    .join(" | ")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

it("draws NEXT SITE, REPLAY and SITE SELECT in that order", async () => {
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
    ended.screen,
    "results",
    "the screen a cleared run moves to (specs/ui.md)",
  );

  await h.advance(1);
  const reading = await readingOrder(h);
  let at = 0;
  for (const entry of RESULTS_ITEMS) {
    const found = reading.indexOf(entry, at);
    if (found < 0) {
      fail(
        `the results menu to draw "${entry}", the RESULTS_ITEMS entry after ` +
          `the ${at === 0 ? "start of the screen" : "one before it"} ` +
          "(specs/ui.md)",
        `the screen reads "${reading}"`,
      );
    }
    at = found + entry.length;
  }

  await h.capture("results-menu", "The results menu");
});
