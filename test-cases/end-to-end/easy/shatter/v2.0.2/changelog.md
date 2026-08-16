## `saucer/avoids-star` flies the saucer across the star, not into it

`specs/hazards.md` states the saucer's relationship with the star in one sentence — it
"steers to avoid the star's core, never overlapping it" — and `v2.0.1` gave the item a
second scenario to hold it to the second half of that. It was posed too close in. It
lined the saucer up on the star's row 60 px out — outside the 48 px contact distance,
but deep INSIDE the radius at which any build begins to steer — and sent it at the core
at cruise. Nothing that steers can recover from that: 60 px at 140 px/s is under half a
second of warning, and a craft that answers by adding vertical speed while keeping its
crossing speed still clips the core, since a full-cruise right-angle turn from 60 px out
passes 42 px from the centre. Only clamping the saucer's POSITION out of the core
survives it, which is one way to implement the sentence and not the one it describes, so
the scenario failed conformant builds for the way they steer rather than for overlapping.
It also posed a state a conformant build's own flight cannot reach, the steering being
what keeps it out of there.

That scenario is now a set of crossings. `specs/hazards.md` has the saucer "enter at a
random `y` from the left or right edge and cross the field horizontally at about 140 px/s",
so the item flies exactly that: nine rows, from 80 px below the star's to 80 px above it in
20 px steps, each from the left edge and from the right, and the whole set three times from
different seeds — fifty-four crossings, with the closest approach of all of them deciding
the item. Every one is a course the build's own spawner produces, and the whole approach is
left for the build to steer through.

Fifty-four rather than one or two because both common faults here are invisible in a single
sample. Avoidance is often one-sided, clearing an approach from above and driving one from
below straight through, which is what the rows either side of the star are for. And a build
that rerolls its weave on a timer can have the reroll DISCARD the avoidance it has
accumulated, so whether it clears depends on where the reroll lands in the approach rather
than on which row it came in on. That one is intermittent by construction and does not
respect a tidy sample: one graded build flew dead through the core on two of eighteen
crossings under one set of seeds and cleared all eighteen under another. Repeating the set
is what turns it from a fault the item might notice into one it does. Both graded builds now
fail, closing to 19 px and 10 px of the star's centre; the reference clears the core on all
fifty-four, its worst at 81.9 px against a contact distance of 48.

Fifty-four crossings are affordable because the closest approach is no longer read off
tick-by-tick samples. The sweep strides eight ticks at a time and works out how close the
star came to the straight line BETWEEN two samples, which over 0.067 s of flight is the
saucer's path to within about a pixel. Reading the samples alone at that stride would report
the saucer further out than it got — the wrong direction for a check hunting a build that
came too close — which is why the previous revision had to sample every tick near the star.

The clip is one crossing at the speed it actually runs, and nothing else. That took some
care. The record pass runs `arrange` as well as `act`, with the recording already going,
so measurement posed in `arrange` lands on the clip: fifty-four crossings is thousands of
driver round trips, the browser paints throughout, and a first cut of this item produced
ten seconds of the field jumping about in front of five seconds of saucer.

So `arrange` now poses one crossing and does nothing else, `act` flies it, and every
measurement sits behind an `advance` that deliberately overruns the item's `clipMs`.
Overrunning it unwinds the record pass out of `act` — the runtime's normal end to
filming — so the measurements never run in that pass, while the validate pass has no budget
and reads the same line as one more instant step. The clip is down from 10.2 s to 6.4 s, of
which 5.5 is the crossing itself and the rest is the same posing every other item in this
case opens with.

What the clip shows is the dead-on crossing along the star's own row, which is an ordinary
member of the sweep — reached from its own seed, measured with the other fifty-three — not
a lookalike staged for the camera. It is not the WORST crossing, because that cannot be
known until the sweep has run and the sweep has to follow the filming. The assertion names
the worst instead (`row +80, from the right, game 3`), so a reviewer reads which crossing
decided the verdict and watches what a crossing looks like, rather than watching a minute
of fast-forward to reach either.

## The three `waves` items clear a wave by shooting it, not with `clearRocks`

`waves/count-increases`, `waves/banner` and `waves/plays-through-banner` all reached a
cleared wave by calling `clearRocks()` — one of them with the comment "as if every rock
were destroyed". It is not that. `specs/instrumentation.md` gives `clearRocks` as "removes
every rock from the field, so a scenario can start from a known-empty field or isolate a
single rock it adds": a way to make room, awarding no score and destroying nothing, and
nothing anywhere says a wave turns over on it.

`specs/gameplay.md` says how a wave IS cleared: "no rocks remain on the field, which
happens only by shooting every rock down to nothing". A build may therefore raise its next
wave from the destruction that empties the field rather than from polling the field's
emptiness — the spec's own gloss says the two coincide, and they come apart only under a
debug op that removes rocks without destroying them. A graded build does it the first way.
It clears wave after wave correctly when played, and failed all three items: no banner, no
turnover, and `plays-through-banner` reporting its precondition unsatisfiable because there
was "no banner to play through". Three items, one wrong assumption, no defect.

All three now shoot the wave down. `skipShootRocksDown` in `validation/_helpers.mjs` places
real rounds through `addBullet` on each rock's doorstep and runs the build's own collision
and split code, instantly in both passes, so the forty-odd rounds of armor and fragments
are measured and not filmed. It stops on Smalls as well as on a count, because only
destroying a Small takes a rock off the field: `leave = 1` therefore lands on exactly one
Small, and the filmed `act` is the single shot that empties the field, the banner it
raises, and the denser wave arriving. `count-increases` went from a 30-second clip of an
empty field to three and a half seconds of the transition it grades.

`waves/banner` also drops the ship's invulnerability once the last rock is gone. The grace
is there so the grind's fragments cannot kill the ship, and by the time the banner goes up
the field is empty and nothing can reach it — but a build is free to blink an invulnerable
ship, and the reference blinks five times a second, so the still this item declares caught
a field with no ship on it about half the time. A reviewer holding that up beside a run's
own capture was comparing two coin flips.

Both readings of the clear rule now pass all three items, and mutants still fail them: a
build whose wave number never advances, one that spawns the next wave under the banner
instead of after it, and one that stops simulating while the banner is up.

## `rocks/fragment-fan` splits a rock the star is not pulling on

The parent Large was posed at `(520, 250)`, 163 px from the star, where the pull is about
170 px/s². Three shots take half a second, and over that the well moved the parent's velocity
by 70 px/s — from the `(-80, 0)` the item posed to roughly `(-25, +44)` by the time it died.
The fragments then inherited *that*, so the item was reading a drift the star had built, not
the one it had arranged, and two of the graded builds failed assertions about a leftward
drift that had genuinely stopped being leftward.

The parent now sits at `(320, 620)`, 412 px out towards the bottom-left corner, where the
pull is about 26 px/s² and moves it by some 13 px/s over the same three shots. Gravity is
inverse-square with no cutoff (`specs/simulation.md`), so there is no distance at which it
switches off; what this buys is a confound an order of magnitude smaller than the drift being
read.

That alone would have made the item weaker, which is worth spelling out. Two of the
graded builds kick their fragments perpendicular to **the rock's own course** rather
than perpendicular to **the bullet's travel**, which is what `specs/simulation.md`
specifies. The old placement caught them by accident: gravity had swung the parent's
course 60 degrees away from the shot, so the two conventions pointed in visibly
different directions. With the parent drifting straight along the shot's line — which is
what `(-80, 0)` against a horizontal shot is — they point the same way and the item
cannot tell them apart. Moving the rock out of the well and changing nothing else would
have quietly turned a real catch into a pass.

So the parent now drifts on a **diagonal**, `(-60, -60)` — 85 px/s, a legal Large drift speed
(`specs/hazards.md` gives 60 to 110) — while the shot stays horizontal. The two conventions
now differ by 60 degrees by construction rather than by luck.

The assertions are read off the PAIR rather than off each fragment, which is what makes a
diagonal drift workable. The average of the two velocities is the parent's velocity whatever
the kick did, and the difference between them is twice the kick with the parent's motion
cancelled out. So the average is checked for the posed drift and the difference for the fan:
about 2 x 90 px/s, and lying across the shot rather than along it. Against the two
off-spec builds, 144 of their 180 px/s fan lies along the shot, against a threshold of 30.

Mutants confirm neither half is vacuous: fragments that carry no parent velocity fail all
three drift assertions, and a kick rotated to lie along the shot fails the perpendicularity
one at 180 against the same threshold.

## Six torpedo items hold on the thing they are grading

Every item in the Homing-torpedo category ended its `act` on the instant its measurement was
taken, which is the instant of impact. The verdicts were right and the clips were unwatchable:
one to two seconds that cut on the frame the torpedo touched the rock, before a viewer could
see what the hit produced.

Each now runs the sim on for a second after the reading is taken, so the clip shows the
effect rather than the moment before it. `one-hit-large` and `one-hit-medium` hold on the
fragments coming apart, `destroyed-by-star` on the core that took the torpedo, and
`harder-scatter` on each of its two kills in turn — the whole point of that item being the
comparison between them. The readings are unchanged: each is taken from the snapshot at the
instant the weapon landed, before the hold.

`harder-scatter` also now reads the bullet spread at the instant of that kill, from the
snapshot `actFireUntilGone` already returns, instead of 0.75 s later. It was comparing a
torpedo spread measured at impact against a gun spread measured most of a second after,
which let gravity into one side of the comparison and not the other. Against the reference
the gun spread is now exactly 180 — twice the 90 px/s split kick `specs/simulation.md`
specifies — where before it read 176.4.

`flies-true` was following the torpedo for 96 ticks, which at 420 px/s stops it at x = 554:
short of the star's column at 640, so the reading was taken *before* the closest approach
to the well the item exists to prove it flies through. It now follows for 240 ticks, out to
x = 1058 and well past the star, which both lengthens the clip to 2.9 s and moves the reading
to after the well has had its whole chance to bend the flight. Two of its assertions
dereferenced a torpedo they had only soft-checked the existence of, so a build that launched
nothing crashed the script and was reported as failing to expose the debug API; they are hard
assertions now, and such a build fails on "pressing F launches a torpedo", which is what
actually happened.

`refills-on-respawn` skipped the whole recharge instantly, so the charge indicator went from
full to 36 % between two frames and the clip never showed it empty — leaving nothing for the
refill to be read against. The first 0.8 s of the recharge is now filmed, with the indicator
sitting empty and the fired torpedo crossing the field, and the hold after the respawn is
extended to a second so the refilled bar is on screen long enough to compare. The recharge
the verdict reads is unchanged: the split wait sums to the same 432 ticks.

`flies-true` and `destroyed-by-star` also park a bystander rock. Both empty the field in
`arrange`, and an empty field is a cleared wave, so the longer flights now outlast the wave
banner and a fresh wave arrives mid-measurement — for `flies-true` that meant the torpedo
homing onto a wave rock and the item failing every build. The parking spot is outside the
torpedo's forward acquisition cone from every point on its lane, so it is scenery rather
than a target.

## Nothing seeded changed

No specification, prompt, reference, or manifest moved: the seeded inputs of `v2.0.2` are
byte-for-byte those of `v2.0.1`, and so are its review items — every `id`, `title`,
`description`, `weight`, `domain` and validation script path is the one `v2.0.1` declared.
A score computed against one version is directly comparable with the other; what changes is
which builds the scripts decide correctly.

On the validation side these scripts changed — `_helpers.mjs`, `saucer/avoids-star.mjs`,
`rocks/fragment-fan.mjs`, the three `waves/` items, and six `torpedo/` items
(`refills-on-respawn`, `flies-true`, `destroyed-by-star`, `one-hit-large`,
`one-hit-medium`, `harder-scatter`). No script is new. The only baseline media recaptured
are the outputs of those scripts: the saucer clip, the fan clip and the three wave outputs
in both variants, plus the six torpedo clips in `warhead`. Every other baseline is the
capture `v2.0.1` shipped, untouched.
