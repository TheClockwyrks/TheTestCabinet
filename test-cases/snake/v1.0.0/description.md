## Overview

**Coil** is a neon, grid-locked serpent game for the browser, and one of the
simplest cases in The Test Cabinet's catalog. A snake threads a single
continuous path across a bordered grid, eating pellets that make it grow one
cell longer each time. The more it eats the less room it has, until a single
wrong turn runs it into a wall or its own body and the round ends.

Although the rules read like the oldest phone game there is, Coil is its own
game. Its defining mechanic is the **combo**: pellets eaten in quick succession
build a scoring multiplier that decays the instant you dawdle, so the real game
is planning the most efficient route from one pellet to the next rather than
merely surviving. Three further modes layer on top of the classic board —
wrapping tunnel edges, a course of fixed obstacles, and a timed high-value bonus
orb.

## Why it is a benchmark

Coil looks trivial and is deliberately so on the surface — but building a
version a person would actually *enjoy* is not. A strong implementation needs a
correct fixed-timestep loop decoupled from rendering, grid-locked turning that
never lets a fast double-press fold the snake onto itself, the subtle
self-collision rule that lets the snake chase its own retreating tail, food
placement that stays correct as the board fills, a decaying combo, persistent
high scores, and the menus and state transitions that tie a title screen, live
play, and a game-over screen together. That makes it a clean low-end anchor for
the suite: the kind of task a capable model and harness should largely nail,
against which the harder cases can be measured.

## What a model is given

A run receives the self-contained specification and the rendered reference
screenshots that act as visual targets — the title screen, gameplay, and the
game-over screen. The reference *source* mockups are withheld, so the look has
to be rebuilt from the specification rather than copied. There are no assets to
provide: Coil's visuals are simple enough to draw entirely in code.
