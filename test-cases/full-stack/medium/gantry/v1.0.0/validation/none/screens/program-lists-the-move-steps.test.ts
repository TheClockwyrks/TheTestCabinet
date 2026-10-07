// program — the tape editor lists the move steps in order, with their commands.
//
// `specs/ui.md` § Program: "`program` shows the same yard and readouts, with the
// tape editor over it: the steps in order, each move's commands and each action
// legible, and the editing the tape editor offers". This check decides that for
// MOVE steps: the two steps posed are listed in the order the tape holds them,
// and each one's command is legible as what `specs/program.md` says a command is
// — "A command is `{ axis, target, rate }`: drive that axis to the absolute
// `target` at up to `rate`." The action steps are their own point.
//
// TWO STEPS, ONE COMMAND EACH, so ORDER is a thing the reading can decide: a
// single step could be listed anywhere and still be "in order".
//
// EVERY FIGURE IS DISTINCT AND UNLIKE ANYTHING ELSE THE SCREEN CARRIES. The
// targets are `137` and `13`, the rates `21` and `3` — each inside its axis's
// max rate (`specs/program.md`) so the editor accepts it — and the structure is
// cleared, so the cost readout reads zero and no other figure on the screen can
// stand in for a command's.
//
// EACH COMMAND IS LOOKED FOR ON ONE LINE OF THE EDITOR rather than anywhere on
// the screen. "Legible" is about a command being readable as a command, so its
// axis, its target and its rate have to be drawn together; a build is free to
// draw them as one run of text or as three, and grouping by line reads both.
// Order is then the order those two lines fall in, top to bottom.

import { afterEach, beforeEach, it } from "vitest";
import { drawnTextRuns, type TextDraw } from "../case-harness/index";
import { assertEqual, assertLength, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";
import { drawnFigures, type DrawnFigure } from "./figures";

/** The two steps, each carrying one command with figures of its own. */
const TAPE: readonly TapeStepSpec[] = [
  { kind: "move", commands: [{ axis: "slew", target: 137, rate: 21 }] },
  { kind: "move", commands: [{ axis: "hoist", target: 13, rate: 3 }] },
];

/** How far a drawn figure may sit from the one it reads: whole units. */
const FIGURE_TOL = 0.5;

/** Runs of text this far apart in `y` are on one line of the editor. */
const LINE_SLOP = 10;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * What the frame the page last drew put on its readout layer: the runs of text
 * it spells, and the figures those runs show.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together, and every raw string is a substring of its
 * run, so coalescing can only add a match.
 *
 * The FIGURES come off the same operations through `./figures`, this
 * directory's one reading of a number, which reads the merged runs and the raw
 * draws they were coalesced from together — so a target or a rate a build
 * grouped with a plain space inside one `fillText` reads as the figure, while
 * the space the merge itself writes between two draws still separates two of
 * them. Every figure keeps the run it was read inside, which is what puts it on
 * one line of the editor rather than loose on the screen.
 */
interface ReadoutReading {
  /** Every logical run the frame spelled, placed where it was drawn. */
  readonly runs: TextDraw[];
  /** Every figure those runs show, each carrying its run. */
  readonly figures: DrawnFigure[];
}

async function readoutText(harness: Harness): Promise<ReadoutReading> {
  const calls = await harness.screenCalls();
  return { runs: drawnTextRuns(calls), figures: drawnFigures(calls) };
}

/** One line of the editor: everything drawn on it, and the figures on it. */
interface EditorLine {
  /**
   * The runs on that line, left to right, joined with a space each.
   *
   * Joined only to be READ BACK in a failure message and to be searched for the
   * axis's name — never for its figures, which come off `./figures` and so are
   * never fused across the space this join writes.
   */
  readonly text: string;
  /** Every figure drawn on that line. */
  readonly figures: number[];
}

/** One line of the editor: everything drawn within `LINE_SLOP` of a `y`. */
function lineAt(read: ReadoutReading, y: number): EditorLine {
  return {
    text: read.runs
      .filter((draw) => Math.abs(draw.y - y) <= LINE_SLOP)
      .sort((one, two) => one.x - two.x)
      .map((draw) => draw.text)
      .join(" "),
    figures: read.figures
      .filter((figure) => Math.abs(figure.run.y - y) <= LINE_SLOP)
      .map((figure) => figure.value),
  };
}

/** Whether a line names the axis and carries both of the command's figures. */
function readsCommand(
  line: EditorLine,
  axis: string,
  target: number,
  rate: number,
): boolean {
  if (!line.text.toLowerCase().includes(axis)) return false;
  const { figures } = line;
  return (
    figures.some((one) => Math.abs(one - target) <= FIGURE_TOL) &&
    figures.some((one) => Math.abs(one - rate) <= FIGURE_TOL)
  );
}

it("lists each move step's command as an axis, a target and a rate, in order", async () => {
  await openSite(h, 0);
  await clearAll(h);
  await poseTape(h, TAPE);
  await h.debug.setScreen("program");
  await h.advance(1);

  const state = await h.snapshot();
  assertEqual(state.screen, "program", "the screen the tape editor is on");
  assertLength(state.program, TAPE.length, "the steps the tape carries");

  const draws = await readoutText(h);
  const found: number[] = [];
  for (const step of TAPE) {
    if (step.kind !== "move") continue;
    const command = step.commands[0] as {
      axis: string;
      target: number;
      rate: number;
    };
    const at = draws.runs.find((draw) =>
      readsCommand(
        lineAt(draws, draw.y),
        command.axis,
        command.target,
        command.rate,
      ),
    );
    if (at === undefined) {
      fail(
        `the tape editor to list the ${command.axis} command legibly, as its ` +
          `axis, its target ${command.target} and its rate ${command.rate} ` +
          "together (specs/ui.md, specs/program.md)",
        `the screen's lines read [${[
          ...new Set(
            draws.runs.map((draw) => lineAt(draws, draw.y).text.trim()),
          ),
        ].join(" | ")}]`,
      );
    }
    found.push(at.y);
  }

  const [first, second] = found as [number, number];
  await h.capture("program-moves", "The move steps listed");

  if (!(first < second)) {
    fail(
      "the tape's first step listed above its second: the editor lists the " +
        "steps in order (specs/ui.md)",
      `the first step's line is drawn at y ${first} and the second's at ` +
        `y ${second}`,
    );
  }
});
