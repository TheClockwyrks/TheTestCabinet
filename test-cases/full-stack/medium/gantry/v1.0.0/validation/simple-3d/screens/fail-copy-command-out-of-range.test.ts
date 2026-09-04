// screens/fail-copy-command-out-of-range — a command outside its axis's range is
// read out as A COMMAND WAS OUT OF RANGE.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `command-out-of-range` the copy `A COMMAND WAS
// OUT OF RANGE`. This check decides that one row of that table, and no other.
//
// THE TAPE ASKS THE HOIST FOR ONE UNIT PAST ITS RANGE. specs/program.md § The
// axes bounds the hoist at "`HOIST_MIN` (`1`) to `HOIST_MAX` (`40`)", and § The
// tape says both that the editor takes the target as written — "Targets are
// accepted as written: whether a target is reachable depends on the structure, so
// it is judged when the step starts" — and what judging it finds: "A step whose
// command targets a value outside its axis's range at that moment ends the run as
// `command-out-of-range`." One unit past the bound is the smallest ask that is
// outside it, and the hoist's bound is a fixed figure rather than one the crane
// decides, so the verdict does not depend on what was built.
//
// The failure lands on the tick that takes the step, which is the run's first, so
// no later stage of the pipeline has run and no other cause was available.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HOIST_MAX, HOIST_MAX_RATE, FAIL_TEXT } from "../constants";
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
import { drawnText, toDrawCall } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "command-out-of-range" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** One unit past `HOIST_MAX`: the smallest ask outside the hoist's range. */
const OVER_THE_BOUND: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "hoist", target: HOIST_MAX + 1, rate: HOIST_MAX_RATE }],
};

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
  const ops = await harness.screenOps();
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

it("reads a command past its axis's range out as A COMMAND WAS OUT OF RANGE", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await poseTape(h, [OVER_THE_BOUND]);

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
    "the run screen after a command outside its axis's range",
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
