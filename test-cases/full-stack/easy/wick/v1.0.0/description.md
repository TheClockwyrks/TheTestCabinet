# Wick

Wick is a survival game for the browser. A lamplighter is alone in a
moth-choked city at night, and everything in the dark is drawn to the light.
The player only moves. The lamplighter's tools fire on their own, each on its
own rhythm, and what the player decides is where to stand and what to take at
each level-up. The night lasts ten minutes: reach dawn and the run is won; run
out of health and the light goes out.

The game's breadth is the point. Ten weapons each have their own targeting and
shape, from a slash in the facing direction to bolts at the nearest enemy,
orbiting lanterns, puddles scattered at random, strikes on random targets, a
bolt that bounces off the edges of the view, a decelerating boomerang, and a
burst that hits everything on screen, and each has an eight-row level table.
Ten passives are single terms in ten derived-stat formulas. Six evolutions
transform a maxed weapon when a chest is opened beside the right passive.
Thirteen enemies, among them a drifting gnat swarm and a weaving wisp, arrive
on a twenty-window spawn schedule that ends with two mothwings, an owl, and
the Dark, a pursuer the lamplighter outruns until dawn.

Wick is a full-stack case with a 2D asset contract: the build draws every
sprite and sheet, from the lamplighter's walk cycle to twenty-seven icons and a
ground tile, and produces every cue and a looping music bed with the asset
tools, then wires them into the game it renders.

The simulation is exact by design. It advances on a fixed tick, every random
draw comes from one seeded generator, and a debug surface poses the night
directly: spawn an enemy here, grant this weapon, set the clock to nine
minutes. No operation sets an outcome; hits, kills, gems, and evolutions come
from stepping the real systems, so a build can be measured on any part of its
roster without playing through a night to reach it.
