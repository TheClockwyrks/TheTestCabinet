## Overview

**Shatter** is a neon, top-down space-rock shooter for the browser. You pilot a
single ship adrift in a square of deep space, turning and thrusting under pure
momentum while jagged rocks tumble around you. Firing splits a large rock into
smaller ones, the smaller ones into smaller ones still, until the last fragments
wink out — and every cleared field is answered by a denser wave, with an enemy
saucer wandering in to hunt you.

What makes Shatter its own game is the **gravity well**. A star fixed at the center
of the field pulls on everything that flies ballistically — your ship, every
bullet, and every rock. Flight becomes a constant negotiation with that tug: you
can slingshot around the star for speed, and you can bend a shot around it to
hit a rock on the far side, but drift into its core and you die. Rocks the star
swallows are recycled straight back in from the edge, so the well churns the
entire board without ever emptying it.

## Why it is a benchmark

Shatter reads like a familiar arcade classic, but a version a person would actually
enjoy is a real front-end build. It asks for smooth inertial flight, a live gravity
field integrated across many bodies every frame, rocks that split and scatter by
the angle of your shot, escalating waves, an enemy that weaves and fires aimed
shots, lives and safe respawns around a lethal hazard, and the menus and state
transitions that tie a title screen, live play, and a game-over screen
together — all on a seamless wrap-around field. That places it in the middle of
the suite: a substantial but tightly specified task whose signature mechanic
exercises a model's grasp of real-time physics.

## What a model is given

A run receives the self-contained specification and the rendered reference
screenshots that act as visual targets — the title screen, gameplay, and the
game-over screen. The reference *source* mockups are withheld, so the look has to
be rebuilt from the specification rather than copied. There are no assets to
provide: Shatter's visuals are simple enough to draw entirely in code.
