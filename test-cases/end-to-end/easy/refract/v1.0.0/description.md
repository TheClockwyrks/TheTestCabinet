## Overview

**Refract** is a light-tracing puzzle for the browser, played on a dark optical
bench. A board is a lattice of optical nodes: emitters that anchor a beam,
lenses it has to thread, and crystals holding one to three charges that any beam
may spend. A board carries up to three channels, triangle, square and diamond.
Each channel wants a single beam running between its two emitters, through every
one of its lenses, and clear of every node belonging to another channel.

A beam is drawn. The player presses on a node and traces, and the beam follows
the pointer from node to node while the rules refuse, silently, any move that
would break them. A refused move simply does not happen, and the trace stays
live. Grabbing a beam anywhere along its length shortens it to that node and
resumes from there. The board is solved when every beam is complete and every
crystal is exactly spent.

Two ways to play ship in every build, chosen from the title menu.

- Campaign: a course of twenty-four hand-built boards in four sets of six,
  opened in order as each is solved, with a select grid and a completion screen.
- Cascade: endless. The game carries a seeded generator that emits a solvable
  board on demand, holds every board to its tier's difficulty floor, and climbs
  the tier as boards fall — five tiers, five boards each.

## Why it is a benchmark

Refract has no physics, no opponent and no clock. What it has is a rule set that
has to be exactly right and enforced on every single pointer move. Nine rules
govern a beam, split into two halves that behave differently: five are limits,
checked on each move and refusing it, and four are completion conditions,
evaluated over a finished board and never used to refuse anything. Treating a
completion condition as a limit rejects the first segment of every board,
because an empty beam does not yet satisfy it. Around the rules sit a board
generator that must produce genuinely solvable boards from a seed, pointer input
resolved against a hit radius smaller than half the cell pitch, two modes with
six screens between them, and a debug surface that drives the real input path.

The rest of the difficulty is in the details:

- A crystal's charge is spent on entry, so a crystal with no charge left refuses
  the beam at the door, and a beam that stops on one leaves it unsatisfied.
- The two diagonals of any 2x2 block are mutually exclusive, so beams never
  visibly cross.
- A beam carries the order it was drawn in, so shortening it is well defined.
- Solving the board ends the live trace on that frame, so a solved board cannot
  be un-solved by retracting.

The look is open. Refract fixes the geometry: the stage, the cell pitch, the
cell-center formula and the hit radius. The palette, the type, the node artwork
and the drawing of a beam are left to the build. What it does fix about
appearance is legibility: three channels told apart at a glance by hue and again
by silhouette, an emitter outlined where a lens is filled, and a crystal showing
both its charges and how many are spent.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the
run selects. On an engine run the project also carries the runtime and the
case-owned modules that name every figure the specification fixes and stand the
engine up, and the run writes the game and its debug surface against them. On an
engineless run the project carries no source at all, and the run writes the
runtime as well as the game, its pointer handling included. There are no assets
and no reference mockups. The specification fixes the geometry, the rules, the
twenty-four campaign boards and the generator's contract exactly, and the bench
is drawn entirely in code.
