// Orrery — the ten instruction glyphs (specs/assets.md "The sprites").
//
// One 24 x 24 PNG per name in `INSTRUCTIONS`, drawn centered in its tape
// cell. Twenty-four units is small, so each glyph is carried by three tells at
// once and no glyph leans on any one of them:
//
//   SHAPE   the mark says what the instruction does — jaws for the grip pair,
//           a concentric ring for the rotations, an arc about an OFF-CENTER
//           pivot dot for the pivots, a shaft leaving or entering a fixed
//           block for the piston pair, and a carriage over a laid track for
//           the track pair.
//   COLOR   each pair takes a color of its own from the one palette — brass
//           for the grip, pale gold for rotation, cold steel-blue for the
//           pivots, ember for the piston, and pale lavender for the track —
//           so a tape's five families separate before any shape is read.
//   HAND    within a pair the two differ by direction: the arrowhead sits at
//           the opposite end of the same figure, so `rotate-cw` is never
//           mistaken for `rotate-ccw` in a row of cells.

import { Raster, faded, polar, rgba } from "./raster.mjs";
import { BRASS, EMBER, STEEL } from "./palette.mjs";

/** The glyph canvas, INSTRUCTION_GLYPH_SIZE. */
export const SIZE = 24;
const C = SIZE / 2;

/** Pale gold: the rotations turn the part itself. */
const TURN = { body: rgba("#f6dca6"), edge: rgba("#8a6428") };
/** Cold steel-blue: a pivot turns what is HELD, about the gripper. */
const PIVOT = { body: rgba("#9fbdd8"), edge: rgba("#33465c") };
/** Ember: the piston is the one part whose own length changes. */
const PUSH = { body: EMBER.lit, edge: rgba("#7a3a0c") };
/** Pale lavender: the track pair moves a base along laid cells. */
const RIDE = { body: STEEL.pale, edge: STEEL.shadow };

/** `grab` — the jaws closed on a mote. */
function grab(g) {
  g.disc(C, C, 4.2, BRASS.shadow);
  g.disc(C, C, 3.2, BRASS.lit);
  g.disc(C - 1, C - 1.2, 1.4, BRASS.high);
  for (const side of [-1, 1]) {
    const x = C + side * 6.4;
    g.rect(x - 1.6, 5, 3.2, 14, BRASS.shadow);
    g.rect(x - 1.2, 5, 2.4, 14, BRASS.mid);
    g.rect(x - side * 2.4 - 1.2, 5, 2.4, 3, BRASS.lit);
    g.rect(x - side * 2.4 - 1.2, 16, 2.4, 3, BRASS.lit);
  }
}

/** `drop` — the jaws thrown open, the mote falling clear. */
function drop(g) {
  for (const side of [-1, 1]) {
    const x = C + side * 8.4;
    g.rect(x - 1.6, 2, 3.2, 11, BRASS.shadow);
    g.rect(x - 1.2, 2, 2.4, 11, BRASS.mid);
    g.rect(x - side * 3 - 1.2, 2, 3.6, 2.4, BRASS.lit);
  }
  g.rect(4, 1, 16, 2, BRASS.dark);
  for (const [y, alpha] of [
    [11, 0.35],
    [14, 0.6],
  ]) {
    g.rect(C - 2, y, 4, 1, faded(BRASS.pale, alpha));
  }
  g.disc(C, 18.4, 4.2, BRASS.shadow);
  g.disc(C, 18.4, 3.2, BRASS.lit);
  g.disc(C - 1, 17.4, 1.4, BRASS.high);
}

/**
 * A turn arrow: a ring broken at one gap, swept from `start` through 250
 * degrees, with the head on the end the sweep ARRIVES at. Clockwise sweeps
 * toward rising bearings and counterclockwise toward falling ones, so the two
 * glyphs are mirror images that never read as each other.
 */
function turnArrow(g, tone, clockwise) {
  const r = 7.4;
  const span = 250;
  const start = clockwise ? -55 : 235;
  const end = clockwise ? start + span : start - span;
  const from = Math.min(start, end);
  g.sector(C, C, r + 1.6, r - 1.6, from, from + span, tone.edge);
  g.sector(C, C, r + 1, r - 1, from, from + span, tone.body);
  const [hx, hy] = polar(C, C, r, end);
  const heading = clockwise ? end + 90 : end - 90;
  g.arrowhead(hx, hy, heading, 9, 40, tone.edge);
  g.arrowhead(hx, hy, heading, 7.2, 38, tone.body);
  g.disc(C, C, 2.4, tone.edge);
  g.disc(C, C, 1.4, tone.body);
}

/** `rotate-cw` — the part turns one step clockwise about its own base. */
function rotateCw(g) {
  turnArrow(g, TURN, true);
}

/** `rotate-ccw` — the same, counterclockwise. */
function rotateCcw(g) {
  turnArrow(g, TURN, false);
}

/**
 * A pivot arrow: an arc about an OFF-CENTER bead — the gripper the held
 * constellation swings about — rather than about the cell's own middle. The
 * bead is the tell that separates a pivot from a rotation at a glance.
 */
function pivotArrow(g, clockwise) {
  const px = clockwise ? 5 : SIZE - 5;
  const py = SIZE - 5;
  const r = 12.4;
  const from = clockwise ? -85 : 185;
  const span = 80;
  g.sector(px, py, r + 1.6, r - 1.6, from, from + span, PIVOT.edge);
  g.sector(px, py, r + 1, r - 1, from, from + span, PIVOT.body);
  const end = clockwise ? from + span : from;
  const heading = clockwise ? end + 90 : end - 90;
  const [hx, hy] = polar(px, py, r, end);
  g.arrowhead(hx, hy, heading, 9, 40, PIVOT.edge);
  g.arrowhead(hx, hy, heading, 7.2, 38, PIVOT.body);
  g.disc(px, py, 3.6, PIVOT.edge);
  g.disc(px, py, 2.4, PIVOT.body);
  g.disc(px, py, 1.1, rgba("#eef6ff"));
}

/** `pivot-cw` — the held constellation turns about the gripper, clockwise. */
function pivotCw(g) {
  pivotArrow(g, true);
}

/** `pivot-ccw` — the same, counterclockwise. */
function pivotCcw(g) {
  pivotArrow(g, false);
}

/** The piston's fixed block, on the left of both piston glyphs. */
function block(g) {
  g.rect(2, 6, 5, 12, PUSH.edge);
  g.rect(3, 7, 3, 10, PUSH.body);
  g.rect(3, 7, 3, 2, rgba("#ffe2a8"));
}

/** `extend` — the shaft driven out, away from the block. */
function extend(g) {
  block(g);
  g.rect(7, C - 2.4, 9, 5, PUSH.edge);
  g.rect(7, C - 1.6, 9, 3, PUSH.body);
  g.arrowhead(21.4, C, 0, 7.4, 40, PUSH.edge);
  g.arrowhead(21, C, 0, 6, 38, PUSH.body);
}

/** `retract` — the shaft drawn back, toward the block. */
function retract(g) {
  block(g);
  g.rect(13, C - 2.4, 9, 5, PUSH.edge);
  g.rect(13, C - 1.6, 9, 3, PUSH.body);
  g.arrowhead(8.6, C, 180, 7.4, 40, PUSH.edge);
  g.arrowhead(9, C, 180, 6, 38, PUSH.body);
}

/** The laid track both track glyphs ride: sleepers under a rail. */
function track(g) {
  g.rect(1, 17, 22, 3, RIDE.edge);
  g.rect(1, 17, 22, 1, RIDE.body);
  for (const x of [3, 8, 13, 18]) g.rect(x, 20, 3, 2, RIDE.edge);
}

/** A carriage: the moving base, drawn as a solid head running the track. */
function carriage(g, forward) {
  const heading = forward ? 0 : 180;
  const tip = forward ? 21.4 : 2.6;
  const tail = forward ? 5 : 19;
  g.line(tail, 10, tip, 10, RIDE.edge, 7.4);
  g.line(tail, 10, tip - (forward ? 4 : -4), 10, RIDE.body, 5);
  g.arrowhead(tip, 10, heading, 8.4, 44, RIDE.edge);
  g.arrowhead(tip - (forward ? 0.9 : -0.9), 10, heading, 6.8, 42, RIDE.body);
  g.disc(tail, 10, 2, RIDE.edge);
}

/** `advance` — a mounted base carried to the next cell of its track. */
function advance(g) {
  track(g);
  carriage(g, true);
}

/** `recede` — the same, to the previous cell. */
function recede(g) {
  track(g);
  carriage(g, false);
}

const MARKS = {
  grab,
  drop,
  "rotate-cw": rotateCw,
  "rotate-ccw": rotateCcw,
  "pivot-cw": pivotCw,
  "pivot-ccw": pivotCcw,
  extend,
  retract,
  advance,
  recede,
};

/** Every instruction's name, in the order `INSTRUCTIONS` lists them. */
export const NAMES = Object.keys(MARKS);

/** Paint one instruction glyph. */
export function paintInstruction(name) {
  const mark = MARKS[name];
  if (!mark) throw new Error(`no instruction named ${name}`);
  const g = new Raster(SIZE, SIZE);
  mark(g);
  if (g.painted === 0) throw new Error(`the ${name} glyph painted nothing`);
  return g;
}
