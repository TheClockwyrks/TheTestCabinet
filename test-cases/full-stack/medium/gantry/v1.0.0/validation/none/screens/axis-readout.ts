// screens/axis-readout — which figures on the run screen belong to which axis.
//
// `specs/ui.md` § Run lists the run screen's readouts, the first of them being
// "Each axis's value and its command's target while one is live". That fixes
// WHAT is on screen and nothing else: no label, no spelling, no layout. So a
// check that wants one axis's figures has to work out which figures are that
// axis's, and it may lean on nothing beyond the sentence above and the four
// axis names `specs/program.md` § The axes gives — `slew`, `trolley`, `hoist`
// and `grip`.
//
// THE READOUT IS AN ANCHOR AND THE FIGURES NEAREST IT. A readout that shows
// "each axis's value" says which axis it belongs to, so the axis's own name
// anchors it; every figure the frame drew is then attributed to the anchor it is
// nearest, and an axis's readout is the figures attributed to its anchors. That
// is the whole model, and it holds a readout drawn as a row (`SLEW  0.01`), one
// drawn as a stack (`SLEW` with `0.01` under it), and one drawn as a single line
// carrying all four (`S 3.9  T 0.5  H 2.8  G 11.6`) — none of which `specs/ui.md`
// prefers over the others.
//
// WHY NOT A BAND ACROSS ONE BASELINE, which is the obvious reading and the wrong
// one: the stage is 1280 units wide and a build is free to draw a second column
// of readouts down the far side of it, so a band picks up a run a thousand units
// away that has nothing to do with the axis, and it misses the value a stacked
// readout draws a line below its own label. Both are layouts `specs/ui.md`
// allows, and a build drawing either is showing each axis's value.
//
// THE TWO BOUNDS ARE THE READOUT'S OWN AND THE STAGE'S. A figure counts as one
// of an anchor's only if it is inside both:
//
//   - Vertically, half the gap between one axis's name and the next, which is
//     the line at which a figure stops being nearer this axis than the one
//     beyond it. Where a build draws every axis on one baseline there is no gap,
//     and the bound is `LINE_SLOP`.
//   - Horizontally, a quarter of the stage (`STAGE_W`), because a readout and
//     the figure it shows are one panel of it. A figure further off than that is
//     another readout, wherever a build has put it.
//
// AN AXIS ABBREVIATED TO ITS INITIAL IS STILL NAMED. `specs/ui.md` fixes no
// spelling, and the four axis names begin with four different letters, so `S`,
// `T`, `H` and `G` name them without ambiguity. The initial is read as an anchor
// ONLY where the frame names that axis in full nowhere — a build that writes
// `SLEW` out is read by its own word — and only where it stands as its own token
// immediately before a figure, which is what tells the `S` of `S 3.9` apart from
// the `s` of `RUN 1.00 s` and the `S` of `STEP 1 / 1`.
//
// THE FRAME IS READ THROUGH `./figures`, this directory's one reading of a
// number, so a figure a build grouped with a space inside one `fillText` reads
// as the figure while the space the merge writes between two draws still parts
// two of them. Every figure keeps the run it was read inside, which is what
// places it against an anchor.

import { drawnFigures } from "./figures";
import { STAGE_W } from "../constants";
import type { AxisName } from "../harness";
import type { DrawCall } from "../case-harness/draw-calls";
import { drawnTextRuns, type TextDraw } from "../case-harness/text";

/** Anything the frame drew text at, placed in stage units. */
type Placed = TextDraw;

/** The frame's runs of text, and every figure they carry with its own run. */
function readFrame(calls: readonly DrawCall[]): {
  runs: readonly Placed[];
  figures: readonly { value: number; run: Placed }[];
} {
  return { runs: drawnTextRuns(calls), figures: drawnFigures(calls) };
}

/** One naming of an axis on the screen, and where it was drawn. */
interface Anchor {
  readonly axis: AxisName;
  readonly x: number;
  readonly y: number;
}

/** The four axes `specs/program.md` tabulates, in that order. */
export const AXES: readonly AxisName[] = ["slew", "trolley", "hoist", "grip"];

/** Runs this far apart in `y` sit on one line of the readout. */
const LINE_SLOP = 10;

/** How far from an axis's name a figure may sit and still be that readout's. */
const COLUMN_REACH = STAGE_W / 4;

/** Where in a run something at character `index` of its text was drawn. */
function placeIn(run: Placed, index: number): { x: number; y: number } {
  const width = run.right - run.left;
  const along = run.text.length > 0 ? (index / run.text.length) * width : 0;
  return { x: run.left + along, y: run.y };
}

/** Every place a run of text spells `axis` out in full. */
function namedInFull(runs: readonly Placed[], axis: AxisName): Anchor[] {
  const found: Anchor[] = [];
  for (const run of runs) {
    const text = run.text.toLowerCase();
    for (
      let at = text.indexOf(axis);
      at >= 0;
      at = text.indexOf(axis, at + 1)
    ) {
      found.push({ axis, ...placeIn(run, at) });
    }
  }
  return found;
}

/** Every place a run abbreviates `axis` to its initial before a figure. */
function namedByInitial(runs: readonly Placed[], axis: AxisName): Anchor[] {
  const initial = new RegExp(
    `(?<![A-Za-z])${axis[0]!}(?=\\s*[-+]?[0-9])`,
    "gi",
  );
  const found: Anchor[] = [];
  for (const run of runs) {
    for (const hit of run.text.matchAll(initial)) {
      found.push({ axis, ...placeIn(run, hit.index) });
    }
  }
  return found;
}

/** Every naming of every axis the frame carries, in full or by its initial. */
function anchorsOf(runs: readonly Placed[]): Anchor[] {
  return AXES.flatMap((axis) => {
    const full = namedInFull(runs, axis);
    return full.length > 0 ? full : namedByInitial(runs, axis);
  });
}

/** How far from an anchor a figure may sit vertically and still be its own. */
function rowReach(anchors: readonly Anchor[]): number {
  let gap = Number.POSITIVE_INFINITY;
  for (const one of anchors) {
    for (const two of anchors) {
      if (one.axis === two.axis) continue;
      const apart = Math.abs(one.y - two.y);
      if (apart > 0) gap = Math.min(gap, apart);
    }
  }
  return Number.isFinite(gap) ? Math.max(LINE_SLOP, gap / 2) : LINE_SLOP;
}

/** What one axis's readout carries. */
export interface AxisReadout {
  readonly axis: AxisName;
  /** Whether the frame names this axis at all. */
  readonly named: boolean;
  /** Every figure attributed to this axis's readout. */
  readonly figures: readonly number[];
  /** The runs those figures were read off, for a failure message. */
  readonly reads: string;
}

/**
 * Every axis's readout, read off the frame the page last drew.
 *
 * A figure the frame drew belongs to the anchor it is nearest, provided it is
 * inside both bounds this module's header sets out; a figure inside no anchor's
 * bounds belongs to no axis and is read by nobody.
 */
export function axisReadouts(
  calls: readonly DrawCall[],
): Record<AxisName, AxisReadout> {
  const frame = readFrame(calls);
  const anchors = anchorsOf(frame.runs);
  const reach = rowReach(anchors);
  const figures = new Map<AxisName, number[]>(AXES.map((axis) => [axis, []]));
  const reads = new Map<AxisName, Set<string>>(
    AXES.map((axis) => [axis, new Set<string>()]),
  );
  for (const { value, run } of frame.figures) {
    const at = placeIn(run, Math.max(0, run.text.indexOf(String(value))));
    let nearest: Anchor | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const anchor of anchors) {
      if (Math.abs(at.y - anchor.y) > reach) continue;
      if (Math.abs(at.x - anchor.x) > COLUMN_REACH) continue;
      const away = Math.hypot(at.x - anchor.x, at.y - anchor.y);
      if (away < best) {
        best = away;
        nearest = anchor;
      }
    }
    if (nearest === null) continue;
    (figures.get(nearest.axis) as number[]).push(value);
    (reads.get(nearest.axis) as Set<string>).add(run.text.trim());
  }
  const named = new Set(anchors.map((anchor) => anchor.axis));
  const readout = (axis: AxisName): AxisReadout => ({
    axis,
    named: named.has(axis),
    figures: [...new Set(figures.get(axis) as number[])],
    reads: [...(reads.get(axis) as Set<string>)].join(" | "),
  });
  return {
    slew: readout("slew"),
    trolley: readout("trolley"),
    hoist: readout("hoist"),
    grip: readout("grip"),
  };
}

/** What the frame drew, for the message a build that names no axis gets. */
export function everythingDrawn(calls: readonly DrawCall[]): string {
  return readFrame(calls)
    .runs.map((run) => run.text.trim())
    .join(" | ");
}
