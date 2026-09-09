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
// screen — and the requirement is that the readout is drawn on both. The site's
// name, the cost and the budget are read anywhere on the program screen: the
// specification fixes no layout, and nothing the tape editor draws can be
// mistaken for them. THE STEP COUNT IS HELD TO THE SAME READOUT: a run spelling
// the same text as the build screen's, or a run drawn at the same place that
// carries the same reading. The tape editor draws every step's own index and
// every command's figures, so a bare figure hunt would find a `5` in the editor
// and call it the step count, while a figure at the place the build screen's
// readout stood is that readout. The place is admitted beside the text because
// a build may set the screen's own heading inside its header run — "BUILD" on
// one screen and "PROGRAM" on the other — which changes the run and not the
// readout.
//
// THE YARD IS READ THROUGH THE CAMERA. `specs/state.md` has the camera "persist
// across the three yard screens", so a screen showing the same yard shows it from
// the same pose, and the pose is read back across the switch. The picture itself
// is what the still beside this check shows a reviewer.
//
// SITE `4` IS OPENED, whose budget (`5 600`) and name are unlike anything else on
// either screen, and the tape is seven steps long, so the step count is a figure
// of its own too, past the six palette bindings.

import { afterEach, beforeEach, it } from "vitest";

import { figureRuns, figuresIn, type FigureRun } from "./figures";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIP_MAX_RATE, SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";

/** The site opened: its budget and name are unlike the rest of the screen. */
const SITE = 3;

/**
 * Seven steps, so the tape's count is a figure of its own: past the palette's
 * six bindings, so no run listing the tools can stand in for it on either
 * screen, and unlike every other figure the site puts on the screen.
 */
const TAPE_STEPS = 7;

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

/** `TAPE_STEPS` grip moves, appended through the tape editor's own screen. */
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

/**
 * How far, in canvas pixels, a program-screen run may sit from where the build
 * screen drew a readout and still be drawn at the same place: the rounding of
 * one anchor, since a readout a build keeps is drawn where it was.
 */
const SAME_PLACE_PX = 4;

/** Whether `run` is the readout `shown`: the same copy, or the same place. */
function sameReadout(
  shown: { text: string; x: number; y: number },
  run: { text: string; x: number; y: number },
): boolean {
  return (
    shown.text === run.text ||
    (Math.abs(shown.x - run.x) <= SAME_PLACE_PX &&
      Math.abs(shown.y - run.y) <= SAME_PLACE_PX)
  );
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
  // Each readout: how it is read, and whether the program screen must draw it
  // as the SAME readout (the same text, or the same place) rather than
  // anywhere. Only the step count is held to a place, since only it can be
  // confused with what the tape editor draws.
  const readouts: ReadonlyArray<
    readonly [string, (run: FigureRun) => boolean, boolean]
  > = [
    [
      `the site's name ("${SITE_NAMES[SITE]}")`,
      (run) => run.text.toLowerCase().includes(SITE_NAMES[SITE]!.toLowerCase()),
      false,
    ],
    [
      `the crane's cost (${cost.toFixed(2)})`,
      (run) => carries(run, cost, COST_TOL),
      false,
    ],
    [
      `the site's budget (${budget})`,
      (run) => carries(run, budget, 0.5),
      false,
    ],
    [
      `the tape's step count (${TAPE_STEPS})`,
      (run) => carries(run, TAPE_STEPS, 0.05),
      true,
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

  for (const [what, holds, placed] of readouts) {
    const same = drawn.filter(
      (run) =>
        holds(run) &&
        (!placed || wanted.some((shown) => sameReadout(shown, run))),
    );
    if (same.length === 0) {
      fail(
        placed
          ? `the program screen to show ${what}, the same readout the build ` +
              "screen shows (specs/ui.md)"
          : `the program screen to show ${what} among its readouts (specs/ui.md)`,
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
