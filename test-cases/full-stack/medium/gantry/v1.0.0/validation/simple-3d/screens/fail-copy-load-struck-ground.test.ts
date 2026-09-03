// screens/fail-copy-load-struck-ground — a load lowered through the ground is
// read out as THE LOAD STRUCK THE GROUND.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `load-struck-ground` the copy `THE LOAD STRUCK
// THE GROUND`. This check decides that one row of that table, and no other.
//
// THE CRATE IS PAID OUT THROUGH `y = 0`. specs/statics.md § Collisions: "An
// attached load whose box dips below the ground, its lift point's `y` minus its
// class height falling below `0`, ends the run as `load-struck-ground`... A load
// whose bottom face rests exactly on `y = 0` is on the ground, not through it."
// The crate is taken at the hook point, whose `y` is `PIVOT.y - HOIST_START` — the
// crate's own height above the ground, so it begins exactly on that boundary and
// is clear of it (specs/world.md § Loads: a load pose is "the center of its top
// face"). The tape then lengthens the cable, which lowers the bob, and the first
// tick of that descent puts the box below the plane.
//
// The yard is otherwise empty: no obstacle stands anywhere near the crate, so the
// ground is the only body it can meet, and the load's own weight is small enough
// that nothing the structure carries is close to a limit.

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
const CAUSE = "load-struck-ground" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/** The minimal crane's pivot at the run-start posture: the track origin. */
const PIVOT = { x: 0, y: 4, z: 0 };

/** Where the run hangs the bob, and so where a load is taken with no motion. */
const HOOK = { x: PIVOT.x, y: PIVOT.y - HOIST_START, z: PIVOT.z, yaw: 0 };

/** Light: this check is about the ground, not about what the crane carries. */
const LOAD_MASS = 40;

/** One action step: the lift, taken on the run's first tick. */
const ATTACH: TapeStepSpec = { kind: "action", action: "attach" };

/** Cable paid out, which lowers the bob and the crate hanging on it. */
const PAY_OUT: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "hoist", target: HOIST_START + 2, rate: HOIST_MAX_RATE }],
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

it("reads a load lowered through the ground out as THE LOAD STRUCK THE GROUND", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneLoad(h, "crate", LOAD_MASS, HOOK, HOOK);
  await poseTape(h, [ATTACH, PAY_OUT]);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    60,
    "the run to end",
  );
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture(
    "fail-copy",
    "the run screen after the load was lowered into the ground",
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
