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

import { figureRuns, figuresAcross, type FigureRun } from "./figures";
import { assertEqual, assertLength, fail } from "../assert";
import {
  clearAll,
  createHarness,
  openSite,
  poseTape,
  type Harness,
  type TapeStepSpec,
} from "../harness";

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
 * Every run of text the frame the page last drew put on its readout layer.
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
 * Each run comes back carrying the raw draws that spelled it as well, because
 * a figure is read off BOTH (`./figures`): a space the BUILD wrote inside one
 * draw groups the figure it sits in — this case's own reference sets a cost
 * that way — while a space the MERGE wrote between two draws groups nothing,
 * since the two figures either side of it were drawn apart.
 */
async function readoutText(harness: Harness): Promise<FigureRun[]> {
  return figureRuns(await harness.screenCalls());
}

/** One line of the editor: every run drawn within `LINE_SLOP` of a `y`. */
function lineAt(draws: readonly FigureRun[], y: number): FigureRun[] {
  return draws
    .filter((draw) => Math.abs(draw.y - y) <= LINE_SLOP)
    .sort((one, two) => one.x - two.x);
}

/** What a line reads as, its runs laid out in the order they were drawn. */
function reads(line: readonly FigureRun[]): string {
  return line.map((run) => run.text).join(" ");
}

/**
 * Whether a line names the axis and carries both of the command's figures.
 *
 * The figures are read run by run rather than off the joined line, which is
 * the same answer: no figure is read across two runs either way, because the
 * space a join writes between them is not one the build drew.
 */
function readsCommand(
  line: readonly FigureRun[],
  axis: string,
  target: number,
  rate: number,
): boolean {
  if (!reads(line).toLowerCase().includes(axis)) return false;
  const figures = figuresAcross(line);
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
    const at = draws.find((draw) =>
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
          ...new Set(draws.map((draw) => reads(lineAt(draws, draw.y)).trim())),
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
