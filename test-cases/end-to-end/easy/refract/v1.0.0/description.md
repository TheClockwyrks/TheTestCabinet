## Overview

**Refract** is a light-tracing puzzle for the browser, played on a dark optical
bench. A board is a lattice of optical nodes: **emitters** that anchor a beam,
**lenses** it has to thread, and **crystals** holding one to three charges that
any beam may spend. A board carries up to three channels — triangle, square, and
diamond — and each wants a single beam running between its two emitters, through
every one of its lenses, and clear of every node belonging to another channel.

Its defining idea is that a beam is _drawn_ rather than fired. The player presses
on a node and traces, and the beam follows the pointer from node to node while
the rules refuse, silently, any move that would break them. Nothing is rejected
with a message: a forbidden move simply does not happen and the trace stays live,
so the board teaches by resisting. Grab a beam anywhere along its length and it
shortens to that node and resumes from there, which makes editing a half-solved
tangle as fluid as drawing it in the first place. The board is solved when every
beam is complete and every crystal is exactly spent.

There are two ways to play, both in every build and both chosen from the title
menu. **Campaign** is a course of twenty-four hand-built boards in four sets of
six, opened in order as each is solved, with a select grid and a completion
screen. **Cascade** is endless: the game carries a seeded generator that emits a
solvable board on demand, and the tier it generates at climbs as boards fall.

## Why it is a benchmark

Refract has no physics, no opponent, and no clock. What it has instead is a rule
set that has to be exactly right and enforced on every single pointer move. Nine
rules govern a beam, split into two halves that behave differently: five are
**limits**, checked on each move and refusing it, and four are **completion
conditions**, evaluated over a finished board and never used to refuse anything.
Confusing the two halves is the classic way to get this game wrong — treat a
completion condition as a limit and the first segment of every board is rejected,
because an empty beam does not yet satisfy it.

The rest of the difficulty is quieter and just as real: a crystal's charge is
spent on entry rather than on exit, so a crystal with no charge left refuses the
beam at the door, and a beam that stops on one leaves it unsatisfied rather than
breaking a rule; the two diagonals of any 2x2 block are mutually exclusive, so
beams never visibly cross; a beam carries the order it was drawn in, so
shortening it is well defined; and solving the board ends the live trace on that
frame, so a solved board cannot be un-solved by retracting. Around the rules sit
a board generator that must produce genuinely solvable boards from a seed,
pointer input resolved against a hit radius smaller than half the cell pitch,
two modes with six screens between them, and a debug surface that drives the
real input path.

The look is unusually open. Refract fixes the geometry — the stage, the cell
pitch, the cell-center formula, the hit radius — and fixes nothing about the
palette, the type, the node artwork, or how a beam is drawn. What it does fix is
legibility, because on this board legibility _is_ the gameplay: three channels
told apart at a glance by hue and again by silhouette, an emitter outlined where
a lens is filled, and a crystal showing both its charges and how many are spent.
That leaves the whole visual design to the build and still gives a reviewer
something concrete to judge it against.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint, and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the case-owned
modules that name every figure the specification fixes and stand the engine up,
and the run writes the game and its debug surface against them; on an engineless
run the project carries no source at all, and the run writes the runtime as well
as the game, its pointer handling included. There are
no assets and no reference mockups: the specification fixes the geometry, the
rules, the twenty-four campaign boards and the generator's contract exactly, and
leaves the bench's appearance to the build, drawn entirely in code.
