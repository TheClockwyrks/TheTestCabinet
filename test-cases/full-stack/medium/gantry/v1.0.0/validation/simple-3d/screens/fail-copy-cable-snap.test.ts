// screens/fail-copy-cable-snap — a hoist cable past its cap is read out as THE
// HOIST CABLE SNAPPED.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `cable-snap` the copy `THE HOIST CABLE SNAPPED`.
// This check decides that one row of that table, and no other.
//
// THE CRANE IS THE SMALLEST STRUCTURE A RUN STARTS ON. The ring and one rail off
// its top flange clear all four readiness issues (specs/structure.md § Readiness)
// and nothing else, so the run starts; the rail's near end `(0, 4, 0)` is the
// track origin, so the trolley begins there and the pivot stands over it exactly
// as it does on any crane with that track. Nothing more is built, because nothing
// more is involved: the snap is stage 4 of the tick pipeline and the solves are
// stage 6 (specs/program.md), so the cable's own rule reaches its verdict before
// anything about the structure standing is looked at, and "the first failure a
// tick reaches ends the run with that cause".
//
// THE LOAD IS HUNG ON THE HOOK WHERE THE HOOK ALREADY HANGS, so nothing has to
// move for the cable to be laden: four hundred units plus `HOOK_MASS` at rest pull
// `m * GRAVITY` past `HOIST_CABLE_CAP`, which "snaps the cable and ends the run as
// `cable-snap`" (specs/rigging.md). The tape's one `attach` step is what hangs it,
// on the run's first tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength, fail } from "../assert";
import {
  GRAVITY,
  HOIST_CABLE_CAP,
  HOIST_START,
  HOOK_MASS,
  FAIL_TEXT,
} from "../constants";
import {
  addOneLoad,
  createHarness,
  openSite,
  runUntil,
  startRun,
  type Harness,
} from "../harness";
import { drawnText, toDrawCall } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "cable-snap" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The track origin, and so the pivot at the run-start posture. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the run hangs the bob, and so where a load is taken with no motion. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** Enough that the bob's weight alone is past `HOIST_CABLE_CAP`. */
const LOAD_MASS = 400;

/**
 * The ring, and one rail off its top flange: the smallest ready structure.
 *
 * The rail is horizontal, it is one unbroken stretch of track, it lies in the arm
 * because it ends on a top-flange node, and its two ends stand at different
 * horizontal distances from the slew axis — the four track rules of
 * specs/structure.md § The trolley and the rail — so no readiness issue is raised
 * and the run starts.
 */
async function poseReadyCrane(harness: Harness): Promise<void> {
  await harness.debug.setRing(0, 2, 0);
  await harness.debug.addMember(0, 4, 0, 4, 4, 0, "rail");
}

/** One action step, taken on the run's first tick. */
async function poseTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addActionStep("attach");
}

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

it("reads a snapped hoist cable out as THE HOIST CABLE SNAPPED", async () => {
  assertGreaterThan(
    (HOOK_MASS + LOAD_MASS) * GRAVITY,
    HOIST_CABLE_CAP,
    "the tension the laden bob hangs at, against the cap the cable snaps " +
      "past (specs/rigging.md)",
  );

  await openSite(h, SITE);
  await h.debug.clearObstacles();
  await poseReadyCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h);

  const started = await startRun(h);
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run's first tick is the attach",
  );
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    3,
    "the run to end",
  );
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture("fail-copy", "the run screen after the hoist cable snapped");

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
