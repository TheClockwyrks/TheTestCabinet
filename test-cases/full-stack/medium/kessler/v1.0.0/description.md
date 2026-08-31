## Overview

**Kessler** is an orbital demolition arcade game for the browser. A planet sits
at the center of the field, circled by three rings of derelict satellites and
junk clusters slated for demolition, and the player rides the **deflector** — a
curved paddle on a low circular track above the planet — batting a demolition
ball outward into the rings. Sweeping the derelicts from the sky *is* the
cleanup: every hit chips or breaks one, a breaking derelict may shed a **salvage
pod**, and a caught pod grants the deflector a tool — a wider span, a narrower
one, extra balls, a one-shot shield, or a ball that pierces straight through.
A ball the deflector misses burns up against the planet.

Play is a score attack over endless waves. Clearing a wave refills the rings
faster and worth more, and the run ends when the last ball is lost with no lives
left. What keeps Kessler from being pure reflex is the bounce: where the ball
meets the deflector decides the angle it leaves at, and every other surface
bends the ball gently back toward the radial, so lazy caroms decay and the
strong player *steers* — placing the deflector so the ball comes off it into the
gap, the moving ring, or the last derelict standing.

What lifts Kessler past a plain arcade port is that the model produces the
game's own art and sound itself, during the build, with the asset-generation
tools on the run image's `PATH`. The planet and the five pod sprites are drawn,
the ball's spin is a real six-frame sheet, the destruction burst, impact spark
and burn-up are produced particle systems played through the particle runtime,
and the thirteen cues and two looping music beds are produced too, then wired
into the game. The rings and their derelicts, the deflector, the shield, the
containment field, the starfield and the HUD stay drawn in code.

## Why it is a benchmark

Kessler's simulation lives entirely in polar coordinates around one center, and
that is the trap: every rule is easy to state and easy to get *almost* right.
Contacts are crossing events with direction gates — a ball is saved only as it
crosses the deflector's radius moving inward, hits a derelict's face only as it
crosses the ring's contact radius toward it, and hits an edge only as its angle
crosses into a live arc, whether the ball moved or the ring did. The deflector
bounce is a four-step pipeline — specular reflection, english proportional to
the contact offset, an exit-angle clamp, and the wave's ball speed — and every
other reflection preserves speed, takes a kick from a moving ring, and decays
toward the radial. Around that core sit orbiting rings on per-wave formulas, a
seeded pod stream with pinned draw order, five effects with tick-counted
timers, waves, lives and six screens, all of it deterministic under a seed.

On top of that correctness sits a full production pass: sprites, a sheet, three
particle systems, thirteen cues and two beds that loop without a seam. A tidy
game with code-drawn placeholders, or handsome produced assets bolted to a
bounce that mishandles its english, both fall short; Kessler rewards the model
that gets the code *and* the craft right.

## What a model is given

A run receives the self-contained specification and a configured TypeScript
project to build inside: the Vite, Vitest, ESLint and Prettier toolchain, and
the page with its canvas. How much more it receives depends on the engine the
run selects. On an engine run the project also carries the runtime, the entry
module that stands it up, and a constants module naming every figure the
specification fixes, and the run writes the game and its debug surface against
them. On an engineless run the project carries no source at all, and the run
writes the fixed-tick loop, the canvas fit, input, audio and the overlay as
well as the game.

Kessler ships no pre-made assets and declares no reference mockups. The run
image puts the 2D asset-generation tools on the model's `PATH`, and the model
produces the sprites, the particle systems and the audio with them before
wiring the committed files into the build. The specification fixes the polar
geometry, every contact radius, the bounce pipeline, the ring and wave
formulas, the pod draw and the timers exactly; the palette, the type and the
look of the field and the HUD are the build's.
