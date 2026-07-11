## Overview

**Coil** is a neon, grid-locked serpent game for the browser, and another of the
simpler cases in The Test Cabinet's catalog. The snake never stops: it traces a
single unbroken path across a bordered grid, and every pellet it swallows adds a
cell to its tail. Growth is the whole problem — the longer the snake, the less
free board there is to thread, so the game slowly fills the space it has to move
through until one misjudged turn buries the head in a wall or its own coils.

What keeps Coil from being pure survival is the **combo**. Pellets eaten in
close succession stack a scoring multiplier, but the window decays in a couple
of seconds, so points go to the player who reads the board and takes the
tightest route from one pellet to the next, not the one who simply stays alive
longest. Three variants bend the base game around that idea, each its own board:
**Wrap** opens the four edges into tunnels so the snake loops off one side and
back the other, **Maze** plants a fixed course of fatal obstacles to thread, and
**Feast** drops a high-value bonus orb that lingers only a few seconds before
it's gone.

## Why it is a benchmark

The rules fit in a sentence, which is exactly the trap: a faithful Coil is
mostly in the details that are easy to get *almost* right. The simulation has to
run on a fixed timestep cleanly separated from rendering, so the snake steps at
the same rate on any machine. Turning has to buffer presses without ever letting
a fast double-tap reverse the head into its own neck. Self-collision turns on
one subtlety — the snake may safely chase the cell its tail is vacating, but not
on a tick where it just ate and the tail holds. Pellets have to keep landing on
valid cells as the board crowds, the combo has to decay on simulation time, and
a title screen, live play, and game-over screen have to hand off to one another
with the high score carried across. None of it is deep, but all of it has to be
right, which makes Coil a dependable low-end anchor: alongside Pong, the floor
the harder cases are measured against.

## What a model is given

The model gets the specification in full, split across files by concern, and the
rendered reference screenshots of the title, gameplay, and game-over screens to
aim at. The mockup *source* behind those screenshots is held back, so the look
has to be reconstructed from the spec and the targets rather than lifted. Coil
ships no assets — its board, snake, pellets, and glow are plain enough to draw
entirely in code.
