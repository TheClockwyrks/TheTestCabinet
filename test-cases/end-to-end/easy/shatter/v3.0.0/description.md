## Overview

**Shatter** is a top-down space-rock shooter for the browser, played on one
wrapping field of deep space. You pilot a single ship under pure momentum,
turning and thrusting while jagged rocks tumble around you. Firing splits a large
rock into smaller ones, the smaller ones into smaller ones still, until the last
fragments wink out. Every cleared field is answered by a denser wave, and an
enemy saucer wanders in to hunt you on a cadence of its own.

What makes Shatter its own game is the **gravity well**. A star fixed at the
centre of the field pulls on everything that flies ballistically: every bullet,
every saucer bullet, and every rock. The ship and the saucer are powered craft
the pull never touches, so the star never wrests the ship from the player's
hands. Instead it shapes the board. Shots bend as they cross the centre, so a
bullet can be curved around the star to strike a rock on its far side, and rocks
travel on curved, wrapping paths that keep the whole field churning.

The core of the star is solid. The ship slides along it rather than through it, a
shot that reaches it is absorbed, and a rock the star swallows re-appears from
the field's edge, so the well stirs the board without ever emptying it.

Shatter ships two rulesets. **Base** is the endless arcade game: one hit destroys
a rock, and the ship carries its gun alone. **Warhead** gives rocks armor, so a
large rock takes three hits, and gives the ship a homing torpedo: one guided
munition on a ten-second recharge that flies true through the well and destroys
any rock outright, blasting its fragments apart far harder than the gun does.

## Why it is a benchmark

Shatter reads like a familiar arcade classic, but a version a person would
actually enjoy is a real front-end build. It asks for smooth inertial flight, one
gravity law integrated across every ballistic body every tick, rocks that split
and scatter by the angle of the shot that killed them, escalating waves, an enemy
that weaves and fires aimed shots, lives and safe respawns amid the drifting
hazards, and the menus and state transitions that tie a title screen, live play,
a pause menu, and a game-over screen together. All of it runs on a seamless
wrap-around field where two bodies touching across a seam still collide. That
places it in the middle of the suite: a substantial but tightly specified task
whose signature mechanic exercises a model's grasp of real-time physics.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint, and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the run
selects. On an engine run the project also carries the runtime and the case-owned
modules that name every figure the specification fixes and stand the engine up,
and the run writes the game and its debug surface against them. On an engineless
run the project carries no source at all, and the run writes the frame loop, the
canvas fit, the keyboard, the audio and the overlay as well as the game.

The specification fixes the field, the gravity law, the flight model, the split
ladder, the saucer, the wave loop and the scoring exactly, and leaves the look to
the build, drawn entirely in code. There are no assets and no visual targets.
Every review point is decided by a validator derived from those rules, and the
reviewer's judgement goes into the per-domain ratings of visuals, polish and
feel.
