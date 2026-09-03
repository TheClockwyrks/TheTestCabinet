// screens/fail-copy-loads-unplaced — a tape that runs out with a load still
// waiting is read out as THE TAPE ENDED WITH LOADS UNPLACED.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `loads-unplaced` the copy `THE TAPE ENDED WITH
// LOADS UNPLACED`. This check decides that one row of that table, and no other.
//
// THE TAPE NEVER GOES NEAR THE LOAD. specs/program.md § The tick pipeline: "A tick
// that finds no live step and no step left to take is the tick the run ends on:
// cleared if every load is `placed`, otherwise failed as `loads-unplaced`." The
// yard holds one crate, waiting where site 1 asks for it and nowhere near the
// hook, and the tape is a short hoist move that ends with the crate exactly where
// it began — so the run reaches the end of the tape with one load unplaced, which
// is the only way to that cause.
//
// Nothing else in the yard can end the run first: one waiting load, which "is
// tested against nothing" while it waits (specs/statics.md § Collisions), no
// obstacles, and a bare hook that stays above the ground throughout.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { HOIST_MAX_RATE, HOIST_START, FAIL_TEXT } from "../constants";
import {
  addOneLoad,
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
const CAUSE = "loads-unplaced" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** Site 1's own crate, waiting at its authored pose (specs/sites.md § Site 1). */
const LOAD_MASS = 40;
const WAITING = { x: 10, y: 2, z: 0, yaw: 0 };
const PAD = { x: 0, y: 2, z: 10, yaw: 0 };

/** A move that ends: the run then finds no step left, with the crate waiting. */
const A_SHORT_HOIST: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "hoist", target: HOIST_START + 1, rate: HOIST_MAX_RATE }],
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

it("reads a tape that ran out with a load waiting out as THE TAPE ENDED WITH LOADS UNPLACED", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, WAITING, PAD);
  await poseTape(h, [A_SHORT_HOIST]);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    200,
    "the run to end",
  );
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture(
    "fail-copy",
    "the run screen after the tape ended with a load still waiting",
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
