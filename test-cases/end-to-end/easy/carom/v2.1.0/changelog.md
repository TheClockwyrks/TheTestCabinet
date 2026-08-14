## Obstacle corners are checked, not just face midpoints

The four obstacle bank-shot points (`ball.bounce-a-left` and its siblings) each
strike a vertical face at its **midpoint**, travelling dead level. That is the
easiest place on the obstacle to resolve — the ball is 70 px from either end, so
which face it struck is never in doubt — and because those shots carry no vertical
velocity, there is nothing for a second, spurious reflection to reverse. Between
them the four points prove every vertical face reflects, and prove nothing about
the ends of those faces.

The new Ball point **`corner-graze`** covers the ends. Three shots at a shallow
20° arrive on a vertical face 4 px inside its end — inside the ball-radius-deep
zone where deciding *which* face was struck is the whole problem, but far enough
onto the face that the specification's answer is unambiguous. Between them they
cover both obstacles, both vertical faces, and both ends: obstacle A's top-left
and bottom-left corners, and obstacle B's top-right.

Each graze asserts the bank happened *and* that the ball left still travelling the
way it arrived vertically. `specs/playfield.md` already requires that only the
component normal to the struck face reverses, so a build that reflects on both
axes at once — sending the ball back down the path it arrived on rather than
banking off the face — now fails a point instead of passing the checklist clean.
The bank assertion comes first in each pair, so the vertical one cannot pass
vacuously on a build that never reflected the ball at all.

The reading is deliberately taken a few ticks **after** the horizontal direction
turns. A build that resolves the corner on the wrong axis reflects vertically
first and only reverses `vx` on the following step, so a reading taken the instant
`vx` turns lands between the two reflections and sees a correct-looking bank.

## Scoring

The common checklist gains one point (weight 1) in the **Ball** category, so this
version's total declared weight differs from `v2.0.1` and a score computed against
one is not directly comparable with the other. No requirement was added or
removed, no prompt or reference was touched, and no existing item's `id`,
`weight`, `domain`, `reference`, `proof`, or validation script moved. Two seeded
spec passages were reworded — see the section below — but only to withdraw a
sentence that could be read against a requirement already stated elsewhere; what a
build is asked to do is unchanged.

## The render-decoupling requirement no longer contradicts itself

`specs/balls.md` and `specs/instrumentation.md` require the simulation to run on
a fixed timestep **decoupled from rendering**, and then described that
decoupling as "Rendering reads the state, never the other way around." Read as a
constraint on the renderer, the second sentence says the opposite of the first:
it pins what is drawn to whatever the last completed step left behind, tying the
picture to the tick boundary rather than freeing it from one.

The wording now states the requirement only as the one-way dependency it is —
the simulation never reads from, waits on, or is driven by the renderer — and
says nothing about how the renderer presents that state. Nothing was added to
what a build must do: the decoupling requirement is the one that was already
there, and the sentence that could be read against it is gone.

## The reference implementation draws between simulation steps

The simulation runs at 120 Hz and a frame is presented whenever the display asks
for one. The two rates do not divide evenly, so the number of steps that run
between two frames varies, and drawing the raw state moved the ball, the
paddles, and the comet trail behind the ball a different distance each frame —
about half a step of position error, arriving metronomically at the beat
frequency between the tick rate and the refresh rate. It is worst on a 120 Hz
display, where one step per frame is the nominal rate and a single missed step
freezes the picture outright for that frame.

Each step now stamps where the moving objects stood when it began, and the loop
hands the renderer the fraction of the next step the wall clock has already
covered, so it draws between the two. The simulation itself is untouched — the
interpolation state is written by the step and read only by the renderer, never
the other way about — so a given seed and sequence of `step` calls reaches
exactly the state it reached before, and a posed scenario is drawn exactly as it
was stepped.
