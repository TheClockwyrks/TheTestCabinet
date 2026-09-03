// screens/fail-copy-cable-snap — a snapped hoist cable is read out as THE HOIST
// CABLE SNAPPED.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `cable-snap` the copy `THE HOIST CABLE SNAPPED`.
// This check decides that one row of that table, and no other.
//
// THE LOAD'S MASS IS WHAT FAILS THE RUN, and it fails it standing still.
// specs/rigging.md § Cable tension and snapping: "Hanging at rest this is the
// bob's weight, straight down", and "A tick on which `|T|` exceeds
// `HOIST_CABLE_CAP` (`3000`) snaps the cable and ends the run as `cable-snap`".
// The bob is the hook plus the load it holds, so at rest the cable carries
// `(HOOK_MASS + LOAD_MASS) * GRAVITY` — a third again past the cap, a margin no
// swing, rounding, or order of arithmetic can close.
//
// The load waits AT the hook point — the run's starting posture hangs the bob
// `HOIST_START` below the trolley at the track origin — so the `attach` takes it
// on the first tick with no motion of any kind on the way, and the mass is on the
// cable "from this tick's pendulum step on" (specs/rigging.md § Attaching). The
// snap is stage 4 of that same tick (specs/program.md § The tick pipeline), ahead
// of the collisions and the solves, so the cause read here is the first the tick
// reached rather than one of several that were available.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, fail } from "../assert";
import {
  GRAVITY,
  HOIST_CABLE_CAP,
  HOIST_START,
  HOOK_MASS,
  FAIL_TEXT,
} from "../constants";
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
const CAUSE = "cable-snap" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the run hangs the bob, and so where a load is taken with no motion. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** Enough that the bob's weight alone is past `HOIST_CABLE_CAP`. */
const LOAD_MASS = 400;

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

it("reads a snapped hoist cable out as THE HOIST CABLE SNAPPED", async () => {
  assertGreaterThan(
    (HOOK_MASS + LOAD_MASS) * GRAVITY,
    HOIST_CABLE_CAP,
    "the tension the laden bob hangs at, against the cap the cable snaps " +
      "past (specs/rigging.md)",
  );

  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
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
