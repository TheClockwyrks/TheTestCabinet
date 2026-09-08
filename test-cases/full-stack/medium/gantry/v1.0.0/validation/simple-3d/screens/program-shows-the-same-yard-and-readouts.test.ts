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
// of its own too.

import { afterEach, beforeEach, it } from "vitest";

import { figureRuns, figuresIn, type FigureRun } from "./figures";
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
 * Every run of text the frame the page last drew put on its readout layer, each
 * carrying the raw draws that spelled it.
 *
 * A figure is read off BOTH (`./figures`): a space the BUILD wrote inside one
 * draw groups the figure it sits in — this case's own reference sets a cost
 * that way — while a space the MERGE wrote between two draws groups nothing,
 * since the two figures either side of it were drawn apart.
 */
async function readoutText(harness: Harness): Promise<FigureRun[]> {
  return figureRuns(await harness.screenCalls());
}

/** Whether a run of text carries a figure within `tolerance` of `wanted`. */
function carries(run: FigureRun, wanted: number, tolerance: number): boolean {
  return figuresIn(run).some((one) => Math.abs(one - wanted) <= tolerance);
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
  const before = await readoutText(h);

  const cost = built.structure.cost;
  const budget = built.site.budget;
  const readouts: ReadonlyArray<
    readonly [string, (run: FigureRun) => boolean]
  > = [
    [
      `the site's name ("${SITE_NAMES[SITE]}")`,
      (run) => run.text.toLowerCase().includes(SITE_NAMES[SITE]!.toLowerCase()),
    ],
    [
      `the crane's cost (${cost.toFixed(2)})`,
      (run) => carries(run, cost, COST_TOL),
    ],
    [`the site's budget (${budget})`, (run) => carries(run, budget, 0.5)],
    [
      `the tape's step count (${TAPE_STEPS})`,
      (run) => carries(run, TAPE_STEPS, 0.05),
    ],
  ];

  const wanted: FigureRun[] = [];
  for (const [what, holds] of readouts) {
    const drawn = before.filter(holds);
    if (drawn.length === 0) {
      fail(
        `the build screen to show ${what} among its readouts (specs/ui.md)`,
        `it draws [${before.map((one) => one.text.trim()).join(" | ")}]`,
      );
    }
    wanted.push(...drawn);
  }

  await h.debug.setScreen("program");
  await h.advance(1);
  const after = await h.snapshot();
  assertEqual(after.screen, "program", "the screen the tape editor is on");

  const drawn = await readoutText(h);
  await h.capture(
    "program-yard",
    "The yard and readouts under the tape editor",
  );

  for (const [what, holds] of readouts) {
    const same = wanted.filter(
      (run) => holds(run) && drawn.some((one) => one.text === run.text),
    );
    if (same.length === 0) {
      fail(
        `the program screen to show ${what}, the same readout the build ` +
          "screen shows (specs/ui.md)",
        `it draws [${drawn.map((one) => one.text.trim()).join(" | ")}]`,
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
