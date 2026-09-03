// screens/fail-copy-collapse — a structure that cannot stand is read out as THE
// STRUCTURE COLLAPSED.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `collapse` the copy `THE STRUCTURE COLLAPSED`.
// This check decides that one row of that table, and no other.
//
// THE CRANE IS THE SMALLEST STRUCTURE A RUN STARTS ON, AND IT IS A MECHANISM. The
// ring and one rail off its top flange clear all four readiness issues
// (specs/structure.md § Readiness) and nothing else, so the run starts rather than
// being refused — "a ready structure may still be a mechanism" — while the rail's
// far node has no member resisting a vertical displacement and no member reaches
// the bottom flange or an anchor at all. specs/statics.md § Singularity: "A
// singular solve, in either the arm or the tower, at any point in the slack-cable
// iteration or the breakage sequence, ends the run as `collapse`."
//
// Nothing is built beyond those two parts, which is what keeps the run's route to
// its verdict as short as the specification allows: there is no member to break,
// no counterweight to fall, and the yard is emptied, so the first tick's solve is
// the whole of what ends the run. The tape is a `grip` move, the one axis whose
// motion "applies no force to anything" (specs/rigging.md § The grip), so nothing
// the tape does contributes to the verdict either.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIP_MAX_RATE, FAIL_TEXT } from "../constants";
import {
  createHarness,
  openSite,
  runUntil,
  startRun,
  type Harness,
} from "../harness";
import { drawnText, toDrawCall, type RecordedOp } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "collapse" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/**
 * The ring, and one rail off its top flange: ready, and a mechanism.
 *
 * The rail is horizontal, it is one unbroken stretch of track, it lies in the arm
 * because it ends on a top-flange node, and its two ends stand at different
 * horizontal distances from the slew axis — the four track rules of
 * specs/structure.md § The trolley and the rail — so `invalid-rail` is not raised
 * and neither is any other readiness issue.
 */
async function poseReadyCrane(harness: Harness): Promise<void> {
  await harness.debug.setRing(0, 2, 0);
  await harness.debug.addMember(0, 4, 0, 4, 4, 0, "rail");
}

/** A move that turns the bare hook, which applies no force to anything. */
async function poseTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  await harness.debug.addMoveStep("grip", 90, GRIP_MAX_RATE);
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

it("reads a singular solve out as THE STRUCTURE COLLAPSED", async () => {
  await openSite(h, SITE);
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await poseReadyCrane(h);
  await poseTape(h);

  const started = await startRun(h);
  assertLength(
    started.structure.members,
    1,
    "the members the crane this run collapses under carries: the one rail " +
      "(specs/structure.md)",
  );
  assertLength(
    started.program,
    1,
    "the steps the tape took, so the run runs the grip move and nothing else",
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
  await h.capture("fail-copy", "the run screen after the structure collapsed");

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
