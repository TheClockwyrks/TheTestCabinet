## Overview

**Coil** is a neon, grid-locked serpent game for the browser. The snake never
stops: it traces a single unbroken path across a bordered grid, and every pellet
it swallows adds a cell to its tail. Growth is the whole problem — the longer the
snake, the less free board there is to thread, so the game slowly fills the space
it has to move through until one misjudged turn buries the head in a wall or its
own coils. It plays in **Maze** mode: the classic open board plus a fixed course
of fatal interior obstacles to navigate around.

What keeps Coil from being pure survival is the **combo**. Pellets eaten in
close succession stack a scoring multiplier, but the window decays in a couple
of seconds, so points go to the player who reads the board and takes the
tightest route from one pellet to the next, not the one who simply stays alive
longest.

What lifts Coil past a plain arcade port is that the model **produces the
snake's own art and the game's sound itself**, during the build, with the
asset-generation tools on the run image's `PATH`. The snake is drawn as a real
sprite set — an animated head that bites when it eats, and body and corner
sprites that render it turning into a continuous coil — and the eat, combo, and
death cues and the music bed are produced too, then wired into the game. The
board, walls, obstacles, pellet, and HUD stay drawn in code.

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
right — and on top of that correctness the model has to carry a small art-and-
audio pass: pixel-art snake sprites that turn cleanly, a head that animates a
bite on the eat, and produced sound and music. A tidy game with a code-drawn
snake, or crisp sprites bolted to a game that mis-handles turning, both fall
short; Coil rewards the model that gets the code *and* the craft right.

## What a model is given

The model gets the specification in full, split across files by concern, and the
rendered reference screenshots of the title, gameplay, and game-over screens to
aim at. The mockup *source* behind those screenshots is held back, so the look
has to be reconstructed from the spec and the targets rather than lifted. Coil
ships **no** pre-made assets: instead the run image puts the 2D asset-generation
tools on the model's `PATH`, and the model produces the snake's sprite set and
the game's sound and music with them before wiring the committed files into the
build.
