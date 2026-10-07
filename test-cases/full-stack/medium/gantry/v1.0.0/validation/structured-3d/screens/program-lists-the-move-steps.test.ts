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
import type { TextDraw } from "../case-harness/index";
import { alongBaseline, drawnFigures, type DrawnFigures } from "./figures";
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
 * The figures the frame the page last drew put on its readout layer, and the
 * runs it spelled.
 *
 * The runs are the LOGICAL ones the frame spells, each placed where its first
 * draw was, never the `fillText` split: a build that letter-spaces a label or
 * a figure draws a glyph per call, which is the only portable way to
 * letter-space canvas text, and a line assembled from those glyphs reads `1 2`
 * where the screen says `12`. `screenCalls` carries the measured geometry the
 * shared merge rule (`case-harness/text.ts`) needs to put side-by-side glyphs
 * on one baseline back together.
 *
 * The figures come from `./figures`, this project's one reading of a number on
 * the screen, which reads those runs together with the RAW draws underneath
 * them. The runs alone cannot be read for a figure a space groups, because the
 * merge writes an ASCII space of its own wherever it crosses a word gap and a
 * run's spaces are therefore not all the build's; the raw draws alone cannot be
 * read for the letter-spaced figure above. Read together, a figure either one
 * carries is a figure the frame drew.
 */
async function readoutFigures(harness: Harness): Promise<DrawnFigures> {
  return drawnFigures(await harness.screenCalls());
}

/** One line of the editor: everything drawn within `LINE_SLOP` of a `y`. */
function lineAt(runs: readonly TextDraw[], y: number): string {
  return runs
    .filter((run) => Math.abs(run.y - y) <= LINE_SLOP)
    .sort((one, two) => one.x - two.x)
    .map((run) => run.text)
    .join(" ");
}

/**
 * Whether the line at `y` names the axis and carries both of the command's
 * figures.
 *
 * The axis is looked for in the line's COPY and the two figures in the line's
 * PLACEMENT: the figures are read off everything drawn on that baseline, runs
 * and raw draws alike, rather than out of the string the copy was assembled
 * into, so a target a space groups inside one call is read as the one figure it
 * is.
 */
function readsCommand(
  frame: DrawnFigures,
  y: number,
  axis: string,
  target: number,
  rate: number,
): boolean {
  if (!lineAt(frame.runs, y).toLowerCase().includes(axis)) return false;
  const figures = frame.where(alongBaseline(y, LINE_SLOP));
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

  const frame = await readoutFigures(h);
  const found: number[] = [];
  for (const step of TAPE) {
    if (step.kind !== "move") continue;
    const command = step.commands[0] as {
      axis: string;
      target: number;
      rate: number;
    };
    const at = frame.runs.find((run) =>
      readsCommand(frame, run.y, command.axis, command.target, command.rate),
    );
    if (at === undefined) {
      fail(
        `the tape editor to list the ${command.axis} command legibly, as its ` +
          `axis, its target ${command.target} and its rate ${command.rate} ` +
          "together (specs/ui.md, specs/program.md)",
        `the screen's lines read [${[
          ...new Set(frame.runs.map((run) => lineAt(frame.runs, run.y).trim())),
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
