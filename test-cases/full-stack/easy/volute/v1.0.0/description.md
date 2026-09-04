## Overview

**Volute** is an arcade puzzle game for the browser, set in a geothermal pump
hall. Mineral cores precipitate at the inlet and ride a fixed, winding channel
toward the intake as one slow, unbroken train. The player works the injector the
channel coils around, firing cores into the train to gather three or more of a
charge together and pull them out before the head of the train reaches the maw.

The train never stops, and a channel that stays crowded builds pressure,
which feeds straight back into the speed the train rides at, so a hall left
alone gets faster on its own. Cores extracted bleed the pressure off again.
Every twelfth core carries a mark, and drawing a marked core out grants one
of four pieces of machinery: choke slows the feed, backflow drives the whole
train back toward the inlet, bore blows a hole in the channel around the
extraction, and sightline draws the aim ray to the first core it meets.
Five levels add charges and speed over the same channel, and three cells are all
a run gets.

What gives the game its ceiling is the chain. An extraction leaves a gap,
the detached tail closes at a fixed catch-up rate, and if the cores that meet
across that join match, that run comes out too, at the next chain step and for
double. A shot placed well ahead of the gap can pay several times over.

Volute is a full-stack case: the model builds the game and produces every
sprite, sheet, particle effect, and sound it plays, during the run, with the
asset-generation tools on the run image's `PATH`. The five core sprites and
their glyphs, the four machinery marks, the injector and the intake maw, the
channel plate, the HUD icons, the fire recoil and swallow and extraction sheets,
four live particle systems, thirteen cues and two music beds are all authored
during the build and wired into it. The HUD, the screens, the sightline ray, and
the debug overlay stay drawn in code.

## Why it is a benchmark

Almost every rule in Volute is a table row or a one-line formula, which is
exactly the trap: the case is easy to describe and unforgiving to get almost
right. A core's position on the channel is one number, its arc distance from the
inlet, and every rule reads and writes that number rather than a point on the
field — a build that tracks positions instead drifts on the corners and never
recovers. A fired core seats ahead of or behind the core it struck on the sign
of a dot product, and getting the side wrong makes a different game rather than
a slightly wrong one. Segments advance at two different rates, merge by clamping
rather than by overshooting, recoil by a fixed distance clamped at the inlet,
and hold before they move again. The chain steps up on a merge and lapses on a
timer.

None of it is deep, and all of it has to be right, which is what separates
builds. On top of that correctness the model has to carry an art-and-audio pass:
five charges a player tells apart at a glance and still tells apart without
color, sprites that read against the plate they stand on, an extraction that
flashes and bursts, and fifteen cues including two beds that swap the moment the
hall goes into danger. A correct hall behind flat rectangles, or a handsome hall
whose shots seat on the wrong side, each falls short.

## What a model is given

The model receives the specification in full, split across eleven files by
concern, and a starter project for the engine the run selected: the toolchain
and an `index.html` and nothing else on no engine, or the same plus the
case-owned entry and figures under one of the two engines. It ships no
pre-made assets. The run image puts the six 2D asset-generation tools on the
model's `PATH`, and the model produces the hall's art, effects, and sound with
them before committing the files and bundling them into the build.
