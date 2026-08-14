## The render-decoupling requirement no longer contradicts itself

`specs/simulation.md` and `specs/instrumentation.md` require the simulation to
run on a fixed timestep **decoupled from rendering**, and then described that
decoupling as "rendering reads the state rather than driving it" and "Rendering
reads the state, never the other way around." Read as constraints on the
renderer, those sentences say the opposite of the requirement they follow: they
pin what is drawn to whatever the last completed step left behind, tying the
picture to the tick boundary rather than freeing it from one.

The wording now states the requirement only as the one-way dependency it is —
the simulation never reads from, waits on, or is driven by the renderer — and
says nothing about how the renderer presents that state. Nothing was added to
what a build must do: the decoupling requirement is the one that was already
there, and the sentences that could be read against it are gone.

## The reference implementation draws between simulation steps

The simulation runs at 120 Hz and a frame is presented whenever the display asks
for one. The two rates do not divide evenly, so the number of steps that run
between two frames varies, and drawing the raw state moved the ship, the rocks,
the bullets and the saucer a different distance each frame — about half a step
of position error, arriving metronomically at the beat frequency between the
tick rate and the refresh rate. It is worst on a 120 Hz display, where one step
per frame is the nominal rate and a single missed step freezes the picture
outright for that frame.

Each step now stamps where each body stood when it began, and the loop hands the
renderer the fraction of the next step the wall clock has already covered, so it
draws between the two. The field is a torus, so a body crossing a seam carries
its interpolation window across with it: the wrap relabels a position rather
than moving the body, and the window has to span the one step of real motion
instead of a jump back across the whole field. A bullet's comet is cut at a seam
exactly as before.

The simulation itself is untouched — the interpolation state is written by the
step and read only by the renderer, never the other way about — so a given seed
and sequence of `step` calls reaches exactly the state it reached before, and a
posed scenario is drawn exactly as it was stepped.

## Color checks read the composited pixel, not the raw canvas sample

The five `color` items sample the pixels a build paints and compare them to each
other, so a rock cannot be mistaken for the ship. They compared the **raw** RGB
`getImageData` returns and ignored its alpha, which quietly restricted them to
builds whose canvas is opaque.

`specs/overview.md` fixes the field background color but never says what paints
it, and both answers look identical on screen: a build may fill the background
into the canvas, or leave the canvas clear over a page background of the same
color. On the second kind every field pixel carries an alpha below 255, and the
unpremultiplied color `getImageData` hands back at the low alphas of a neon glow's
outer fringe is rounding noise amplified back up towards saturation. Sampling
picks the pixel *farthest from the background*, so it picked exactly those fringes:
a `#6cf0ff` ship and a `#9aa7bd` rock both came back as near-white, 19 apart,
and each failed the other's "distinct from" assertion at a threshold of 45 — on a
build a reviewer's screenshot shows drawing both in the specified palette. Nothing
about the build was wrong, and no build with an opaque canvas ever saw it.

Every sample is now composited over the field background before it is compared, so
what the check measures is what the display shows. A barely-covered glow pixel
composites back to nearly the background and is no longer mistaken for the element
it surrounds; a covered pixel keeps the color it was painted in whether the canvas
carries the background or lets it through. Compositing needs a backdrop for the
clear case, and that is the background color the palette pins, so `FIELD_BG` joins
the field geometry and the physics constants already in `validation/_helpers.mjs`.
Against a reference implementation, which paints its background into the canvas,
the numbers are unchanged in kind and now land on the palette exactly: ship to rock
measures 108.6, which is the distance between `#6cf0ff` and `#9aa7bd`.

## The color scene is posed after the opening banner, not under it

`specs/ui.md` draws the `WAVE N` banner centered on the field. The star sits at the
center of the field, and `color/star` samples the star at the center of the field.

The color scene posed itself on a bare `startGame()`, which — per the opening
`specs/gameplay.md` allows and `v2.0.0` made explicit — may leave a build showing
its `WAVE 1` banner. For such a build the item read the banner's text rather than
the star, and reported on a glyph under the star's name. It was not a failure that
showed up as a failure: a build whose star core is painted the *same grey as its
rocks* passed `color.star` with numbers identical to a correct build's, because the
mutation never touched the pixels being sampled.

`poseColorScene` now poses on `newGame`, which settles any opening banner first —
the same thing every other scripted item in this case has done since `v2.0.0`. A
build that spawns wave 1 with `startGame` waits no time for it, and the same
mutant now fails the item, as it always should have.

## `saucer/avoids-star` sends the saucer at the core, not just past it

`specs/hazards.md` states the saucer's relationship with the star in one sentence — it
"steers to avoid the star's core, never overlapping it" — and the item drove only the
first half. It posed a saucer at rest just below the core and asked that it move away,
which is the easy case: any push at all satisfies it, so a build whose entire avoidance
is "add some vertical speed while close" passed comfortably. One graded run did exactly
that and crossed the core repeatedly in ordinary play, closing to 23 px of the star's
centre — 25 px inside a surface it may never overlap.

The item now runs a second scenario after the first: the same saucer is lined up on the
star's row 60 px out, twelve px clear of the contact distance, and sent through the core
at the spec's own 140 px/s cruise. At that range a nudge has no time to work, so what is
left is whether the build holds the saucer out of the core at all. The reference does,
landing exactly on the contact distance; the assertion allows a pixel for that, because
what it rejects is sinking into the core rather than grazing its surface. Three of the
five builds this was checked against sink 33 to 46 px in.

## `star-core/rock-recycled` looks at the edge the replacement came from

`specs/hazards.md` says where a recycled rock re-enters: "the replacement enters from
off-screen: pick a random point just outside one of the four edges". The item measured
its distance from the STAR instead, which is a different property and a much weaker one —
everywhere except the middle of the field is far from the star. A build that popped the
replacement into open space 231 px from the nearest edge passed it.

The assertion is now against the nearest edge, with an allowance of the rock's own radius
plus a margin, so it reads the same for a build that reports the rock at the off-screen
point it placed it at and one that reports it already wrapped to the far edge — both are
the perimeter. The item also asserts the size the replacement comes back at, which its own
description has always claimed and nothing verified.

## New item: `saucer/cadence`

Nothing measured how often a saucer comes. `specs/hazards.md` gives a saucer "about 12
seconds" on the field and puts 25 to 35 seconds between one and the next, which together
make it a periodic visitor — the field is clear of saucers for most of a game. A build that
held its saucer for 36 seconds and replaced it 0.05 s after it left had no item to fail.

The new item watches the game's own clock for a minute after the first arrival and records
the longest unbroken stretch with a saucer on the field and the longest without one. It
spawns and removes nothing: `removeSaucer` is exactly the event a build may schedule the
next arrival from, so asking for one would re-roll the interval being measured. Longest-run
figures are used rather than transition timings because a build that replaces its saucer
within a single sample has no observable departure, and an item written around "when did it
leave" reports a sweep that timed out instead of the defect that caused it.

The thresholds are the loosest the spec supports. Its 25-to-35-second interval does not say
between which two events, and both readings are live; the smaller implied gap is 13 s, and
the assertion asks for more than 10. A visit is allowed 16 s, which is "about 12 seconds"
with room for a build that hits the 1.5-field-width limit first.

## Scoring, and what moved

The checklist gains exactly one item against `v2.0.0` — `saucer/cadence` — and is
otherwise unchanged: nothing else was added, removed or re-weighted, and no `id`,
`weight`, `domain`, `reference`, or `proof` moved, so scores remain comparable
across the bump on every item that existed before it.

The only seeded change is the render-decoupling rewording above, in
`specs/simulation.md` and `specs/instrumentation.md`. It withdraws sentences that
could be read against a requirement already stated elsewhere rather than asking for
anything new; every other specification, the prompt, and the reference mockups are
byte-for-byte those of `v2.0.0`.

On the validation side `_helpers.mjs`, `saucer/avoids-star.mjs` and
`star-core/rock-recycled.mjs` changed and `saucer/cadence.mjs` is new. The baseline
media recaptured for them are the `color` stills, the two saucer clips and the
recycle clip; every other baseline is the `v2.0.0` capture, untouched.
