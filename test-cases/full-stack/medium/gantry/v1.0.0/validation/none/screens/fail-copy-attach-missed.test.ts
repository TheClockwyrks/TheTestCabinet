// screens/fail-copy-attach-missed — an `attach` that finds nothing is read out
// as NOTHING TO ATTACH.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `attach-missed` the copy `NOTHING TO ATTACH`.
// This check decides that one row of that table, and no other: the run is driven
// to that cause, and the screen is read for the words.
//
// THE YARD IS EMPTY, which is the whole scenario. specs/rigging.md § Attaching:
// "The candidate is the `waiting` load whose lift point is nearest the hook
// point... With no candidate, the run ends as `attach-missed`." With no load in
// the yard at all there is no candidate at any radius, so nothing about where the
// crane stands, how far the hook hangs, or where a bystander was parked can
// decide the cause. The tape is that one action, so the failure lands on the
// run's first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { FAIL_TEXT } from "../constants";
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
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "attach-missed" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** One action step, taken on the run's first tick. */
const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/**
 * Every run of text the last frame drew on the screen layer.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out in
 * logical stage units" — so the words a screen shows are the runs of text that
 * layer's frame issued, whatever font, colour, or arrangement a build chose for
 * them.
 */
async function screenText(harness: Harness): Promise<string[]> {
  const ops = (await harness.page.evaluate(() =>
    (window as unknown as Record<string, { last(): unknown[] }>)[
      "__tcabRec"
    ]!.last(),
  )) as RecordedOp[];
  return drawnText(ops.map(toDrawCall));
}

/** The copy this check is about. */
const COPY = FAIL_TEXT[CAUSE];

/** The nine it must not be confused with. */
const OTHER_COPY = Object.entries(FAIL_TEXT).filter(
  ([cause]) => cause !== CAUSE,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads a failed attach out as NOTHING TO ATTACH", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [ATTACH]);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    20,
    "the run to end",
  );
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture(
    "fail-copy",
    "the run screen after an attach that found nothing",
  );

  assertEqual(
    ended.run.cause,
    CAUSE,
    "the cause the scenario failed the run with (specs/statics.md)",
  );

  const shown = (await screenText(h)).join(" | ");
  if (!shown.toUpperCase().includes(COPY)) {
    fail(
      `the copy \`FAIL_TEXT\` gives \`${CAUSE}\`, "${COPY}" ` +
        "(specs/ui.md § The failure copy)",
      shown,
    );
  }
  const confused = OTHER_COPY.filter(([, copy]) =>
    shown.toUpperCase().includes(copy),
  );
  if (confused.length > 0) {
    fail(
      `"${COPY}" and no other cause's copy (specs/ui.md § The failure copy)`,
      `it also shows the copy of ${confused.map(([cause]) => cause).join(", ")}`,
    );
  }
});
