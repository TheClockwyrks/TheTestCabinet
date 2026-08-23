## Overview

**Carom** is a neon, top-down paddle duel for the browser, and one of the
simplest cases in The Test Cabinet's catalog. Two paddles face each other across
a dark field while a ball ricochets between them, bouncing off the top and
bottom walls and off a pair of obstacles planted in the middle of the arena. A
point is scored whenever the ball slips past the far edge behind an opponent's
paddle.

Although the rules read like the oldest arcade game there is, Carom is its own
game. Its defining mechanic is **spin**: the motion of a paddle at the instant
it strikes the ball curves the ball's path afterward, so good play is about
*shaping* a shot rather than merely blocking it. The two obstacles turn the open
field into a bank-shot puzzle, rewarding players who can read angles a couple of
bounces ahead.

## Why it is a benchmark

Carom looks trivial and is deliberately so on the surface — but building a
version a person would actually *enjoy* is not. A strong implementation has to
deliver smooth real-time rendering, a believable physics loop with spin, a
competent AI opponent, a local two-player mode, and the menus and state
transitions that tie a title screen, live gameplay, and a game-over screen
together. That makes it a clean low-end anchor for the suite: the kind of task a
capable model and harness should largely nail, against which the harder cases
can be measured.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint, and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the case-owned
modules that name every figure the specification fixes and stand the engine up,
and the run writes the game and its debug surface against them; on an engineless run the
project carries no source at all, and the run writes the runtime as well as the
game. There are no assets and no visual targets: the look is rebuilt from the
palette and measurements the specification fixes, drawn entirely in code.
