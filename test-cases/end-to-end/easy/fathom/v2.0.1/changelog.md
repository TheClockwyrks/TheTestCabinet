## The flare cadence is timed with nothing for the Flarefish to chase

This version changes one validation script and nothing else. The specs, the prompt, the
assets, the variants and every other checklist item are v2.0.0's, unchanged: what a build
must do is exactly what it had to do before.

`flarefish/flare-cadence` times the gap between two consecutive flares, and the
Flarefish has to hold its wander for all of it — `specs/predators/flarefish.md` has it
stop flaring the moment it acquires the forager ("while chasing it stops flaring"), so a
Flarefish that finds the forager mid-count leaves nothing to time. The item posed the
forager eight tiles off and hoped.

Eight tiles is not a berth. The maze is a fixed `36 x 18` tiles, `1152 px` across
(`specs/maze.md`), and the Flarefish wanders it at `116 px/s` — it crosses the whole
board in about five seconds and covers three board-widths in the twenty this item needs,
while its bloom senses `192 px` in every direction straight through rock. Wherever the
forager is parked, the wander arrives. It did: a run reported the item inconclusive
against a build that flares every `9.25 s`, comfortably inside the band the item accepts.
The wander reached the parked forager after `7.65 s`, fixed on it, and caught it two
seconds later, which re-dens every predator. Nothing about that verdict was about the
flare cadence, and a reader of it would have gone looking in the wrong code.

So the forager is now kept out of the way rather than merely placed out of it. It sits at
`G = 0`, the floor of the light-sense range, and whenever the Flarefish closes to within
`288 px` — the bloom's own radius plus three tiles, many times the `29 px` it can cover
between two reads — it is re-posed to the tile furthest from the Flarefish, by the same
`setForager` op that parked it in the first place. Nothing touches the Flarefish, its
state, or its flare timer: the forager is a bystander in this item and this only keeps it
one. The last of those moves is made unconditionally, before the timed gap opens, so on
both reference implementations the clip now contains no move at all.

Two smaller repairs came with it. The walk up to the first flare — which is skipped, not
filmed, and is not the interval being measured — is retried from a fresh far tile if the
wander finds the forager anyway, so an unlucky patrol costs a restart rather than the
verdict. And the two windows the item allows are now named in the assertions that depend
on them (`within 20 s` for the first flare, `within 13 s` for the second), so a Flarefish
that flares far slower than `7 s` fails on a sentence that says what happened rather than
on a bare "it flares while wandering".

What the item asks is unchanged, and it still fails what it should: against reference
implementations mutated to flare every `2 s`, to flare every `25 s`, and never to flare
while wandering, the three failures are the cadence assertion, the first-flare window,
and the first-flare window. The band itself — the gap being `7 s` onset-to-onset or about
`9 s` measured through the flare's own duration, both of them "about every `7 s`" as
written — is the one v2.0.0 settled on, untouched.

The tile the forager steps aside to is chosen by a new finder that scores every candidate
by the *smaller* of two distances, the straight line and the corridor route. A tile far
by one can be next door by the other: the bloom ignores walls, so a long way round is no
protection from rock one tile thick, and the wrap tunnel joins the two mouths of the maze
— as far apart in pixels as tiles get — as adjacent tiles.
