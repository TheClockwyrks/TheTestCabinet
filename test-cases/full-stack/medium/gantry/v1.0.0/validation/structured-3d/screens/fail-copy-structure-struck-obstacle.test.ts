// screens/fail-copy-structure-struck-obstacle — an arm swept into an obstacle is
// read out as THE CRANE STRUCK AN OBSTACLE.
//
// specs/ui.md § The failure copy fixes the words every cause is read out in:
// "Each failure cause (`specs/statics.md`) is shown as the fixed copy `FAIL_TEXT`
// gives it", and its table gives `structure-struck-obstacle` the copy `THE CRANE
// STRUCK AN OBSTACLE`. This check decides that one row of that table, and no
// other.
//
// THE ARM IS SLEWED ONTO A BOX A FEW DEGREES AHEAD OF IT. specs/statics.md §
// Collisions: "A member whose segment reaches inside an obstacle ends the run as
// `structure-struck-obstacle`. Members standing clear at build time can sweep into
// an obstacle as the arm turns; the test catches them tick by tick." The box
// stands where nothing reaches at slew `0` — it begins at `z` `1.5`, and no member
// of the minimal crane past `x` `3` stands higher than `z` `1` — so the editor
// accepts every member and the first tick is clear. The tape then turns the arm,
// and the arm's members sweep the ring of radius `1.41` to `3.16` about the slew
// axis at `(1, ·, 1)` (specs/structure.md § The slew ring) at `y = 4`, where the
// box spans `y` `3` to `5`.
//
// THE BOX IS PUT WHERE THE SWEEP REACHES IT SOONEST, because the copy on the
// screen is what this decides and every tick before the strike is spent on
// nothing. Its near corner stands `2.06` from the slew axis at `14.0` degrees
// round from `+x`, and the crane's own body already reaches that radius at `-1.7`
// degrees, so the strike falls a little under `16` degrees into the turn: one
// second of ramp at `SLEW_ACCEL` and a few ticks of cruise. Which member arrives
// first decides nothing — every one of them is a member, and the cause is the
// same.
//
// The first `CLEAR_TICKS` (`40`) of those cover `6.7` degrees of that ramp, well
// short of the strike, so they are driven in one batch and read once: that
// reading is the other half of the sentence above, that the members stood clear
// where they were built and it is the SWEEP that takes them in. The sweep after
// it finds the tick that does.
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
  runTicks,
  runUntil,
  standMinimalCrane,
  startRun,
  type Harness,
  type TapeStepSpec,
} from "../harness";
import { drawnTextLines } from "../case-harness/index";

/** The cause this check drives the run to. */
const CAUSE = "structure-struck-obstacle" as const;

/** Site 1. Which site it is decides nothing here; its yard is emptied. */
const SITE = 0;

/**
 * A box just off the arm's shoulder, at the height the arm turns at.
 *
 * It spans `y` `3` to `5`, which takes in the arm's `y` of `4`, and `x` `3` to
 * `5` and `z` `1.5` to `3.5`. In the build pose the crane's members at `y` `4`
 * run out along `z` `0` and slope back to `z` `2` only as they come in to `x` `2`
 * and less, so past `x` `3` none of them stands higher than `z` `1` and nothing
 * reaches inside it. Its near corner is `2.06` from the slew axis and inside the
 * ring the arm sweeps, so a few degrees of turn carry a member into it.
 */
const BLOCK_MIN = { x: 3, y: 3, z: 1.5 };
const BLOCK_SIZE = { x: 2, y: 2, z: 2 };

/** Ticks driven before the sweep: the arm is still short of the box at the end. */
const CLEAR_TICKS = 40;

/** A quarter turn: far more than the arm needs to reach the box. */
const SWEEP: TapeStepSpec = {
  kind: "move",
  commands: [{ axis: "slew", target: 90, rate: SLEW_MAX_RATE }],
};

/**
 * Every run of text the last frame drew on the screen layer.
 *
 * specs/overview.md fixes where a readout lives — "over it the screen-space
 * readouts are drawn on a 2D layer composited on top of the picture, laid out in
 * logical stage units" — so the words a screen shows are the runs of text that
 * layer's frame issued, whatever font, colour, or arrangement a build chose for
 * them.
 *
 * Read off the LOGICAL RUNS the frame spells, never off the `fillText` split:
 * a build that letter-spaces its copy draws a glyph per call, which is the only
 * portable way to letter-space canvas text, and the specification fixes the
 * words a screen shows while leaving their spacing to the build. `screenCalls`
 * carries the measured geometry the shared merge rule (`case-harness/text.ts`)
 * needs to put side-by-side glyphs on one baseline back together, and every
 * raw string is a substring of its run, so coalescing can only add a match.
 */
async function screenText(harness: Harness): Promise<string[]> {
  return drawnTextLines(await harness.screenCalls());
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
  const clear = await runTicks(h, CLEAR_TICKS);
  assertEqual(
    clear.run.phase,
    "running",
    `the run after ${CLEAR_TICKS} ticks, with the arm ` +
      `${clear.run.axes.slew.value.toFixed(2)} degrees round and the box still ` +
      "ahead of it: the members stood clear of the obstacle where they were " +
      "built (specs/statics.md § Collisions)",
  );
  const ended = await runUntil(
    h,
    (s) => s.run.phase !== "running",
    150,
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
