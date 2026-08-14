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
one is not directly comparable with the other. Nothing else changed: no
requirement was added, removed, or reworded, no seeded spec, prompt, or reference
was touched, and no existing item's `id`, `weight`, `domain`, `reference`, `proof`,
or validation script moved. A model building this version is given exactly the game
it was given before.
