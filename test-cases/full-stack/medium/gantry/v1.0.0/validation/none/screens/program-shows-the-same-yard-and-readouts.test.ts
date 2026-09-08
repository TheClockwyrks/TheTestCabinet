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
// of its own too. That budget is also why the reading of a figure matters here:
// how a build groups a four-figure number is the build's, and `./figures` —
// this directory's one reading of a number — is what makes `5 600`, `5,600` and
// `5600` one budget without letting the space the harness's merge writes
// between two draws fuse two figures into one.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns, type TextDraw } from "../case-harness/index";
import { assertEqual, assertLength, fail } from "../assert";
import { GRIP_MAX_RATE, SITE_NAMES } from "../constants";
import { createHarness, openSite, type Harness } from "../harness";
import { drawnFigures } from "./figures";

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

/** One run of text the frame drew, and the figures it shows. */
interface Readout {
  /** The run as the frame spells it. */
  readonly text: string;
  /** Every figure that run shows, under `./figures`' reading. */
  readonly figures: number[];
}

/**
 * Every run of text the frame the page last drew put on its readout layer, each
 * with the figures it shows.
 *
 * The figures are attributed to the run they were read inside — the merged run
 * and the raw draws it was coalesced from both answer about the same run — so a
 * readout that carries a figure carries it in ITS OWN run, which is what lets
 * this check say the same readout is drawn on both screens rather than that the
 * figure is loose somewhere on each.
 */
async function readoutText(harness: Harness): Promise<Readout[]> {
  const calls = await harness.screenCalls();
  const drawn = drawnFigures(calls);
  return drawnTextRuns(calls).map((run) => ({
    text: run.text,
    figures: drawn
      .filter((figure) => sameRun(figure.run, run))
      .map((figure) => figure.value),
  }));
}

/**
 * Whether two readings name the same run of the frame.
 *
 * BY WHAT THE RUN IS, NEVER BY IDENTITY. `drawnFigures` does its own
 * `drawnTextRuns` over the same calls, and that function mints a fresh object
 * per run every time it is asked (`case-harness/text.ts`, `runs.push({ ...draw })`),
 * so the run a figure carries is never the same OBJECT as the one the map above
 * walks — an `===` between them is false for every pair, and every readout would
 * come back carrying no figures at all, failing this point against any build the
 * reference included.
 *
 * The merge is deterministic over one frame, so the two readings agree run for
 * run; what identifies one is the copy it spells and where it sits. The baseline
 * and the left edge are both read because two readouts may spell the same word
 * in different places — a bare `0` under two axes is the case this point is most
 * likely to meet — and the copy alone would fold them into one.
 */
function sameRun(a: TextDraw, b: TextDraw): boolean {
  return a.text === b.text && a.y === b.y && a.left === b.left;
}

/** Whether a readout carries a figure within `tolerance` of `wanted`. */
function carries(readout: Readout, wanted: number, tolerance: number): boolean {
  return readout.figures.some((one) => Math.abs(one - wanted) <= tolerance);
}

it("draws the build screen's readouts on the program screen too", async () => {
  await openSite(h, SITE);
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
    readonly [string, (readout: Readout) => boolean]
  > = [
    [
      `the site's name ("${SITE_NAMES[SITE]}")`,
      (readout) =>
        readout.text.toLowerCase().includes(SITE_NAMES[SITE]!.toLowerCase()),
    ],
    [
      `the crane's cost (${cost.toFixed(2)})`,
      (readout) => carries(readout, cost, COST_TOL),
    ],
    [
      `the site's budget (${budget})`,
      (readout) => carries(readout, budget, 0.5),
    ],
    [
      `the tape's step count (${TAPE_STEPS})`,
      (readout) => carries(readout, TAPE_STEPS, 0.05),
    ],
  ];

  const wanted: string[] = [];
  for (const [what, holds] of readouts) {
    const drawn = before.filter(holds);
    if (drawn.length === 0) {
      fail(
        `the build screen to show ${what} among its readouts (specs/ui.md)`,
        `it draws [${before.map((one) => one.text.trim()).join(" | ")}]`,
      );
    }
    wanted.push(...drawn.map((one) => one.text));
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
    const same = drawn.filter(
      (readout) => holds(readout) && wanted.includes(readout.text),
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
