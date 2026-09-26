Wick is a survival game for the browser. A lamplighter is alone in a
moth-choked city at night, and everything in the dark is drawn to the light.
The player only moves. The lamplighter's tools fire on their own, each on its
own rhythm, and the player decides where to stand and what to take at each
level-up. The night lasts ten minutes: reach dawn and the run is won; run out
of health and the light goes out.

Ten base weapons each have their own targeting and shape, from a slash in the
facing direction to bolts at the nearest enemy, orbiting lanterns, puddles
scattered at random, strikes on random targets within range, a bolt that
bounces off the edges of the view, a decelerating boomerang, and a burst that
catches every enemy around the lamp. Each carries an eight-row level table.
Ten passives are single terms in ten derived-stat formulas. Six evolutions
transform a maxed weapon when a chest is opened beside the right passive.
Thirteen enemies, among them a drifting gnat and a weaving wisp, arrive on a
twenty-window schedule, and seven scripted events run over it: three gnat
swarms, two mothwings, an owl, and, at nine minutes, the Dark, a pursuer the
lamplighter outruns until dawn.

Nine screens carry the night. Every menu answers the keyboard and the mouse
alike, the title opens an almanac listing every tool, trinket, enemy and
pickup with its picture, its figures and a line of its own, and the pause
screen holds the world under a menu of its own.

Wick is a full-stack case with a 2D asset contract. The build draws every
sprite and sheet with the asset tools, from the lamplighter's walk cycle to
twenty-seven icons and a ground tile, produces fourteen cues and a looping
music bed, and wires them into the game it renders.

The simulation advances on a fixed tick, free of the renderer and the wall
clock. A debug surface poses the night directly: spawn an enemy here, put this
weapon in that slot at that level, move the clock to nine minutes, land the
next puddle there. A pose fixes only what the game would have drawn: the hits,
kills, gems, and evolutions a build is measured on come from stepping the real
systems, so any part of the roster can be reached without playing a night
through to it.
