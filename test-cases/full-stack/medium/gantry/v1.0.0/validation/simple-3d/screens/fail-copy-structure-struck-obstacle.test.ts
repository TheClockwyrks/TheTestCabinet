// screens/fail-copy-structure-struck-obstacle — an arm swept into an obstacle is
// read out as THE CRANE STRUCK AN OBSTACLE.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `structure-struck-obstacle` the copy `THE CRANE
// STRUCK AN OBSTACLE`. This check decides that one row of that table, and no
// other.
//
// THE ARM IS SLEWED ONTO A BOX BEHIND IT. specs/statics.md § Collisions: "A member
// whose segment reaches inside an obstacle ends the run as
// `structure-struck-obstacle`. Members standing clear at build time can sweep into
// an obstacle as the arm turns; the test catches them tick by tick." The box
// stands where nothing reaches at slew `0` — every node of the crane is at `x` of
// `0` or more and the box ends at `x` `-1` — so the editor accepts every member
// and the first tick is clear. The tape then turns the arm half a circle: the rail
// and its ties sweep the ring of radius `1.41` to `3.16` about the slew axis at
// `(1, ·, 1)` (specs/structure.md § The slew ring) at `y = 4`, and the box spans
// `y` `3` to `5` and reaches within `2` of that axis, so the sweep takes members
// through it.
//
// The yard holds nothing else: no load to strike anything, and a bare hook that
// hangs at `y = 2` above a ground it never reaches.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, fail } from "../assert";
import { SLEW_MAX_RATE, FAIL_TEXT } from "../constants";
import {
  addOneObstacle,
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
const CAUSE = "structure-struck-obstacle" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/**
 * A box behind the crane, at the height the arm turns at.
 *
 * It ends at `x` `-1`, and every node the crane stands on is at `x` `0` or more,
 * so nothing reaches inside it in the build pose. It spans `y` `3` to `5`, which
 * takes in the arm's `y` of `4`, and its near corner is `2` from the slew axis,
 * which is inside the ring the arm sweeps.
 */
const BLOCK_MIN = { x: -3, y: 3, z: 1 };
const BLOCK_SIZE = { x: 2, y: 2, z: 2 };

/** Half a circle: enough that the arm passes over the box on the way round. */
const SWEEP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 180, rate: SLEW_MAX_RATE }],
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

it("reads an arm swept into an obstacle out as THE CRANE STRUCK AN OBSTACLE", async () => {
  await openSite(h, SITE);
  await clearAll(h);
  await standMinimalCrane(h);
  await addOneObstacle(h, BLOCK_MIN, BLOCK_SIZE);
  await poseTape(h, [SWEEP]);

  await startRun(h);
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    600,
    "the run to end",
  );
  // The frame that FOLLOWS the tick that ended it: a failed run "stays here, the
  // scene as it stood, with the failure copy below shown plainly"
  // (specs/ui.md § Run), and nothing ticks under the reading.
  await h.advance(1);
  await h.capture(
    "fail-copy",
    "the run screen after the arm swept into an obstacle",
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
