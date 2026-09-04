// screens/fail-copy-release-misplaced — a load let go away from its pad is read
// out as THE LOAD WAS DROPPED.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `release-misplaced` the copy `THE LOAD WAS
// DROPPED`. This check decides that one row of that table, and no other.
//
// THE PAD IS NOWHERE NEAR WHERE THE LOAD IS LET GO. specs/rigging.md § Releasing
// judges a release on three tests, the first of them "distance from lift point to
// target position at most `PLACE_POS_TOL` (`0.5`)", and "If any test fails, the
// load is dropped and `lost`, and the run ends as `release-misplaced`." The crate
// is taken at the hook point and released on the very next tick, with the pad
// `PAD_DISTANCE` away — sixteen times the tolerance, so no swing, no rounding and
// no reading of where the load hangs can bring it inside the bound.
//
// Two action steps in a row, which "occupy two ticks and never one"
// (specs/program.md § The tick pipeline): the lift lands on the first tick and the
// release on the second, so the run is over before the crate has travelled
// anywhere, and the position test is the one that failed.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import { HOIST_START, PLACE_POS_TOL, FAIL_TEXT } from "../constants";
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
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "release-misplaced" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the run hangs the bob, and so where a load is taken with no motion. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** Light: this check is about where the load is let go, not about its weight. */
const LOAD_MASS = 40;

/** The pad, straight across the yard from the hook. */
const PAD_DISTANCE = 8;
const PAD = { x: HOOK.x, y: HOOK.y, z: HOOK.z + PAD_DISTANCE, yaw: 0 };

/** One action step: the lift, taken on the run's first tick. */
const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** The set-down, taken on the tick after the lift. */
const RELEASE: TapeStepSpec = { kind: "action", action: "release" };

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
  const ops = (await harness.screenOps()) as RecordedOp[];
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

it("reads a load let go away from its pad out as THE LOAD WAS DROPPED", async () => {
  assertGreaterThan(
    PAD_DISTANCE,
    PLACE_POS_TOL,
    "the gap between where the crate is let go and the pad it is wanted on, " +
      "against the tolerance a set-down is judged by (specs/rigging.md)",
  );

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, PAD);
  await poseTape(h, [ATTACH, RELEASE]);

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
    "the run screen after the load was dropped away from its pad",
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
