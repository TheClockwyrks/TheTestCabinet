## Overview

**Coil** is a neon, grid-locked serpent game for the browser. The snake never
stops: it traces a single unbroken path across a bordered grid, and every pellet
it swallows adds a cell to its tail. Growth is the whole problem — the longer the
snake, the less free board there is to thread, so the game slowly fills the space
it has to move through until one misjudged turn buries the head in a wall or its
own coils. It ships two variants, each its own mode: a **base** Classic run on the
open board, and a **Maze** run on a board laced with a fixed course of fatal
interior obstacles to thread.

What keeps Coil from being pure survival is the **combo**. Pellets eaten in
close succession stack a scoring multiplier, but the window decays in a couple
of seconds, so points go to the player who reads the board and takes the
tightest route from one pellet to the next, not the one who simply stays alive
longest.

What lifts Coil past a plain arcade port is that the model produces the snake's
own art and the game's sound itself, during the build, with the
asset-generation tools on the run image's `PATH`. The snake is drawn as a real
sprite set — an animated head that bites when it eats, and body and corner
sprites that render it turning into a continuous coil — and the eat, combo, and
death cues and the music bed are produced too, then wired into the game. The
board, walls, obstacles, pellet, and HUD stay drawn in code.

## Why it is a benchmark

The rules fit in a sentence, which is exactly the trap: a faithful Coil is
mostly in the details that are easy to get _almost_ right. The simulation has to
run on a fixed timestep cleanly separated from rendering, so the snake steps at
the same rate on any machine. Turning has to buffer presses without ever letting
a fast double-tap reverse the head into its own neck. Self-collision turns on
one subtlety — the snake may safely chase the cell its tail is vacating, but not
on a tick where it just ate and the tail holds. Pellets have to keep landing on
valid cells as the board crowds, the combo has to decay on simulation time, and
a title screen, live play, and game-over screen have to hand off to one another
with the high score carried across. None of it is deep, but all of it has to be
right — and on top of that correctness the model has to carry a small
art-and-audio pass: pixel-art snake sprites that turn cleanly, a head that animates a
bite on the eat, and produced sound and music. A tidy game with a code-drawn
snake, or crisp sprites bolted to a game that mis-handles turning, both fall
short; Coil rewards the model that gets the code _and_ the craft right.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and the
page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the entry
module that stands the engine up, and the run writes the game and its debug
surface against them. On an engineless run the project carries no source at all,
and the run writes the fixed-tick loop, the canvas fit, input, audio and the
overlay as well as the game.

Coil ships no pre-made assets and declares no reference mockups. The run image
puts the 2D asset-generation tools on the model's `PATH`, and the model produces
the snake's sprite set and the game's sound and music with them before wiring the
committed files into the build. The specification fixes the board geometry, the
tick rate, the turning and collision rules and the combo exactly; the palette,
the type and the look of the board and the HUD are the build's.
