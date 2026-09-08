// program — the program screen shows the same yard and readouts as build.
//
// `specs/ui.md` § Program: "`program` shows the same yard and readouts, with the
// tape editor over it". What "the readouts" are is fixed one section earlier, on
// the build screen: "Its readouts show the site's name, the cost against the
// budget, the tool palette with each tool's binding and the selected tool
// marked, and the tape's step count."
//
// THREE OF THOSE FOUR ARE READ HERE: the site's name, the cost against the
// budget, and the tape's step count. The tool palette is deliberately left out —
// it is a readout of the BUILD tools, the program screen offers none of them
// (`specs/controls.md` binds the tool actions on the build screen), and reading
// "the same readouts" as carrying the palette onto a screen with no tools would
// be a stricter requirement than the specification means to state. That reading
// is called out in this file rather than left silent, because it is the one
// judgement in it.
//
// EACH READOUT IS READ TWICE — once on the build screen and once on the program
// screen — and the requirement is that the SAME run of text is drawn on both.
// That is what "the same readouts" says, and it is stronger than looking for the
// figures on the program screen alone: the tape editor draws every step's own
// index and every command's figures, so a bare figure hunt would find a `5` in
// the editor and call it the step count.
//
// THE YARD IS READ THROUGH THE CAMERA. `specs/state.md` has the camera "persist
// across the three yard screens", so a screen showing the same yard shows it from
// the same pose, and the pose is read back across the switch. The picture itself
// is what the still beside this check shows a reviewer.
//
// SITE `4` IS OPENED, whose budget (`5 600`) and name are unlike anything else on
// either screen, and the tape is five steps long, so the step count is a figure
// of its own too. The budget is a four-figure number, so how it is grouped is the
// build's — `5600`, `5,600` and `5 600` are one figure written three ways — and
// `./figures` is where this project reads a figure without fixing its setting.

import { afterEach, beforeEach, it } from "vitest";
import { drawnFigures, inRun, type DrawnFigures } from "./figures";
import type { TextDraw } from "../case-harness/text";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIP_MAX_RATE, SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The site opened: its budget and name are unlike the rest of the screen. */
const SITE = 3;

/** Five steps, so the tape's count is a figure of its own. */
const TAPE_STEPS = 5;

/**
 * The crane whose cost the readout carries: the ring and one rail off its top
 * flange.
 *
 * This point is about WHERE the readouts are drawn, not about what a crane costs,
 * so it builds the smallest structure that carries a cost at all — `RING_COST`
 * plus four units of rail, `372` against Long Reach's budget of `5600`, which is
 * a figure no other readout on the screen can be confused with.
 *
 * Read off the LOGICAL RUNS the frame spells, never off the `fillText` split:
 * a build that letter-spaces its copy draws a glyph per call, which is the only
 * portable way to letter-space canvas text, and the specification fixes the
 * words a screen shows while leaving their spacing to the build. `screenCalls`
 * carries the measured geometry the shared merge rule (`case-harness/text.ts`)
 * needs to put side-by-side glyphs on one baseline back together, and every
 * raw string is a substring of its run, so coalescing can only add a match.
 */
async function poseCrane(harness: Harness): Promise<void> {
  await harness.debug.setRing(0, 2, 0);
  await harness.debug.addMember(0, 4, 0, 4, 4, 0, "rail");
}

/** Five grip moves, appended through the tape editor's own screen. */
async function poseTape(harness: Harness): Promise<void> {
  await harness.debug.setScreen("program");
  for (let at = 0; at < TAPE_STEPS; at += 1) {
    await harness.debug.addMoveStep("grip", 30 + at, GRIP_MAX_RATE);
  }
  await harness.debug.setScreen("build");
}

/** A whole force-free unit: the coarsest rounding a build could write. */
const COST_TOL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * The figures the frame the page last drew put on its readout layer, and the
 * runs it spelled.
 *
 * The figures come from `./figures`, this project's one reading of a number on
 * the screen, which reads the frame's raw draws and its coalesced logical runs
 * TOGETHER. Neither half alone reads this screen: a build that letter-spaces the
 * budget draws a glyph per `fillText`, so its figure exists only once the glyphs
 * are put back together into a run, while a build that groups `5600` as `5 600`
 * inside one call — which is what this case's own reference does — has a figure
 * the runs cannot be read for, because the merge writes an ASCII space of its
 * own wherever it crosses a word gap and a run's spaces are therefore not all
 * the build's.
 */
async function readoutFigures(harness: Harness): Promise<DrawnFigures> {
  return drawnFigures(await harness.screenCalls());
}

/**
 * What it takes for one readout of a frame to be the readout being looked for.
 *
 * A readout is a RUN of the frame's text rather than a string, because the two
 * screens are compared readout by readout and a figure is read off the run that
 * carries it together with the draws that spelled it.
 */
type Readout = (frame: DrawnFigures, run: TextDraw) => boolean;

/**
 * Whether the readout `run` spells carries a figure within `tolerance` of
 * `wanted`.
 *
 * Scoped to the one run with `inRun`, so a figure drawn on a different readout
 * cannot stand in for this one; the reading inside that scope is the union
 * `./figures` states, so the run's own draws are read for a figure a space
 * groups as well.
 */
function carries(
  frame: DrawnFigures,
  run: TextDraw,
  wanted: number,
  tolerance: number,
): boolean {
  return frame
    .where(inRun(run))
    .some((one) => Math.abs(one - wanted) <= tolerance);
}

it("draws the build screen's readouts on the program screen too", async () => {
  await openSite(h, SITE);
  // The opening `reset` leaves every site's stored structure and tape empty and
  // `openSite` keeps them (specs/state.md), so only the site's own yard has to be
  // cleared.
  await h.debug.clearLoads();
  await h.debug.clearObstacles();
  await poseCrane(h);
  await poseTape(h);

  const built = await h.snapshot();
  assertEqual(built.screen, "build", "the screen a site opening shows");
  assertLength(built.program, TAPE_STEPS, "the steps the tape carries");
  await h.advance(1);
  const before = await readoutFigures(h);

  const cost = built.structure.cost;
  const budget = built.site.budget;
  const readouts: ReadonlyArray<readonly [string, Readout]> = [
    [
      `the site's name ("${SITE_NAMES[SITE]}")`,
      (_frame, run) =>
        run.text.toLowerCase().includes(SITE_NAMES[SITE]!.toLowerCase()),
    ],
    [
      `the crane's cost (${cost.toFixed(2)})`,
      (frame, run) => carries(frame, run, cost, COST_TOL),
    ],
    [
      `the site's budget (${budget})`,
      (frame, run) => carries(frame, run, budget, 0.5),
    ],
    [
      `the tape's step count (${TAPE_STEPS})`,
      (frame, run) => carries(frame, run, TAPE_STEPS, 0.05),
    ],
  ];

  const wanted: string[] = [];
  for (const [what, holds] of readouts) {
    const drawn = before.runs.filter((run) => holds(before, run));
    if (drawn.length === 0) {
      fail(
        `the build screen to show ${what} among its readouts (specs/ui.md)`,
        `it draws [${before.runs.map((run) => run.text.trim()).join(" | ")}]`,
      );
    }
    wanted.push(...drawn.map((run) => run.text));
  }

  await h.debug.setScreen("program");
  await h.advance(1);
  const after = await h.snapshot();
  assertEqual(after.screen, "program", "the screen the tape editor is on");

  const drawn = await readoutFigures(h);
  await h.capture(
    "program-yard",
    "The yard and readouts under the tape editor",
  );

  for (const [what, holds] of readouts) {
    const same = drawn.runs.filter(
      (run) => wanted.includes(run.text) && holds(drawn, run),
    );
    if (same.length === 0) {
      fail(
        `the program screen to show ${what}, the same readout the build ` +
          "screen shows (specs/ui.md)",
        `it draws [${drawn.runs.map((run) => run.text.trim()).join(" | ")}]`,
      );
    }
  }

  assertEqual(
    JSON.stringify(after.camera),
    JSON.stringify(built.camera),
    "the camera the program screen shows the yard through: it persists across " +
      "the yard screens (specs/state.md)",
  );
});
