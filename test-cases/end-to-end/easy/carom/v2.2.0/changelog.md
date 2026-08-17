## `spin.at-bound` reads the rebound, not a contact flag

Both halves of the point's discrimination asserted that the paddle "strikes the ball",
which is not this point's job — `paddles.hit-center` and `paddles.hit-edge` grade that
a paddle returns a ball, and grading it a third time here says nothing new about spin.

What the point does need from the contact is narrower: that the ball did not pass
_through_ the paddle. The pinned half cannot see that in its own readings, because it
scores two zeroes — a paddle that did not move, a ball that gained no spin — and a ball
that sailed past an unmoved paddle reports both, taking the point without ever touching
it. So each half now reads the rebound itself, as the physics fact it is: the ball's
`vx` turned back toward the far goal, beside the spin it did or did not pick up. A
tunnelled ball crosses the goal line and is held for the pre-serve countdown — ~120
ticks, which `gameplay.countdown-length` pins — well past the sweep's 132-tick cap, so
it cannot turn positive on a fresh serve and pass instead.

## Unpausing is specified, and graded

Up to `v2.1.0` nothing said how a player gets out of a pause.
`specs/modes/single-player.md` and `specs/modes/versus.md` bound `Esc` and `P` as
keys that _enter_ the pause, and `specs/ui.md` said only that on a menu `Esc` "goes
back" — which reads equally as dismissing the pause menu (resume) and as leaving the
match (quit to the title). Builds split on it exactly as that ambiguity predicts:
across four runs of this case, one resumed on `Esc`, one quit to the title, one
ignored the key on the pause menu entirely, and one resumed but to the wrong screen.
Every one of those was a defensible reading, so nothing could be graded — and the two
points that have to leave a pause on their way to checking something else
(`gameplay.countdown-frozen` and `pause.ball-continues`) were failing three of the
four on a choice the specification never made.

The specification now makes it. There are **two** ways back into a match and a build
provides both:

- **The pause key toggles.** `Esc` or `P` pressed on the Paused screen returns to the
  match, stated in both `specs/modes/*.md` beside the binding that opens the pause.
- **The pause menu's `RESUME` entry**, confirmed with `Enter` or `Space`. `specs/ui.md`
  also now says the pause menu opens with `RESUME` selected — and, generally, that
  every menu opens on its first entry, which the case's input-driven points have always
  relied on to pick `SOLO` at the title.

Leaving the match stays the explicit `QUIT TO MENU` entry, which is what settles `Esc`:
on the pause menu, "back" is back into the match. `specs/ui.md` also states what
resuming restores — the screen the pause was taken from, a countdown resuming as a
countdown with the hold it had left still to run.

The new Pause point **`resume`** grades all of it, and it is the only point that does.
It pauses and resumes four times over — `Esc`, `P`, and `Enter` and `Space` on
`RESUME` — and for each reads that the pause opened, that the resume came back to the
screen it was taken from, and that the ball is travelling again afterwards, so a build
that changes the label without restarting the simulation fails on the last of those.
Everything else that merely has to get out of a pause routes through `RESUME`, so a
build that implements one route and not the other loses the point that names it rather
than every point that had to unpause along the way.

Both of those points get sharper in passing. Confirming a menu entry raises a question
`Esc` did not — a build whose pause menu opened on `RESTART` would restart the match,
and the old readings could not tell that from a resume — so `countdown-frozen` now
brackets the resumed hold. 24 of its ~120 ticks ran before the pause, leaving ~96, and
the point reads twice: still counting down 84 ticks in, served by 108. A build that
restarted the hold owes a fresh ~120 and is still counting at 108; one that dropped the
remainder and launched on the resume itself is already playing at 84. Between them they
check what the point's title has always claimed — that the countdown picks up **where
it left off** — which nothing checked before. `gameplay.countdown-length` pins the hold
at 120 ± 3 ticks, so both readings sit 9 ticks clear of a conformant build. The same
point also holds its pause for 318 ticks rather than 636: that is still over three
times what the countdown had left, and it takes 2.6 s of a reviewer watching a frozen
number out of the clip.

`ball-continues` reads its resumed ball 12 ticks on rather than 1. The posed flight
travels 3.33 px per tick horizontally and 1 px vertically, so a single tick moved the
ball less than the 2 px tolerance the reading is compared within: a ball that never
resumed at all sat _inside_ the tolerance on the vertical axis, and 1.33 px outside
it on the horizontal. Twelve ticks put a continued ball 40 px and 12 px on, an order
of magnitude clear either way, and still well short of the obstacles and the walls.

Its horizontal reading is now compared within 5 px rather than 2. Nothing specifies
whether the frame that reads the resume key also integrates, so a build that drains
its input after its update is one 3.33 px tick behind one that drains before it, and
the old tolerance failed the second of two conformant readings. 5 px takes the tick
and gives nothing up: a ball that never resumed is 40 px adrift of the reading, and a
re-served one lands at x 640 — all but exactly where a continued ball does, so that
was never the axis telling those apart. The vertical reading, where a tick is 1 px,
stays at 2 px and keeps doing it, alongside the preserved-speed reading.

The reference implementation resumed on `Esc` but not on `P`, so it gains the toggle
too — the pause key now leaves the Paused screen the same way it enters it.

## The respawning-ball collision is filmed at the collision

`multi-ball.respawn-collision` drove ball 1 out of the goal and waited for its
respawn inside the timed phase, then posed its shot and swept for the rebound a
single tick at a time. Both are recorded, and neither survives being recorded well.
The respawn is the journey to the evidence rather than the evidence, and a one-tick
sweep is 8.3 ms of game time against a driver round trip an order of magnitude
longer — so the clip opened on ball 1 leaving the field, ball 0 then appeared out of
a corner mid-shot, and the recording's length tracked the host rather than the game.
A build that never rebounds ran the sweep to its cap and filmed **15 s** where the
committed baseline is under 3.

The respawn now happens in `arrange`, where `skipUntil` runs the same real simulation
instantly in both passes, and ball 0 is lined up there too — 160 px short of the home
the sweep just found, aimed straight at it. The timed phase is the shot, the contact
and the rebound, flown in one `advance` with only the last 24 ticks swept, and the
tail stops short of the ~120-tick hold the respawning ball is waiting out so the clip
ends with it still sitting at its home. Clips come in at 1.7–2.0 s across builds.

The point also gains an assertion. Its closest-approach reading cannot see a build
that resolves the overlap by teleporting the live ball out the **far** side: such a
ball is never closer than a touch and never rebounds, so it passed "the balls never
overlap or pass through each other" while passing clean through. The live ball
approaches from the left, so it must never reach the respawning ball's center, and
now that is checked by name.

## "The game advances itself in real time" is judged from normal play

The Gameplay point **`advances-in-real-time`** asks whether the build runs on its
own clock — the one claim every other point is blind to, since they all advance the
simulation themselves through `step`. Up to `v2.1.0` it set its scenario up with the
**control** operations (`startMatch`, `serve`) and then watched for motion. That is
outside normal play by definition: `specs/instrumentation.md` has a control op take
the paddles away from the keyboard and the AI, and it never promises that the wall
clock keeps feeding the simulation afterwards. A build that reads a scripted pose as
"hold the clock still until I step it" — a defensible reading, and the one that keeps
a posed scenario free of stray wall-clock frames — was failed by this point while
playing perfectly for a person at the keyboard.

It now drives the scenario the way a player does, with the **input** operations the
spec reserves for exactly this: injected keys flow through the same handling the real
keyboard feeds and, unlike a control op, "do not hand paddle control to a driver". The
point presses `Enter` on the title menu, lets the build serve itself out of the
pre-serve hold, and then measures a fixed window of real time — the simulation clock
must advance, and the ball must actually travel. Both witnesses are read over that one
window, so a build whose clock counts up while its simulation sits still fails the
travel one alone and says so.

The requirement is unchanged, and so is what a build has to do to satisfy it: a build
whose frame loop never runs — one that ships with the manual clock on because it calls
its own `reset` on the boot path — still fails, now on the evidence a player would see.
The two captured stills change with it: they used to show a court that the check itself
had frozen, and now show the ball part-way across the field on the build's own clock.

## Who owns the clock is stated, and the handover is checked

`specs/instrumentation.md` puts the simulation behind two clocks — the animation loop
that plays the game for a person, and the manual one `step` drives — and named `reset`
and `step` as the operations that switch to manual. It left three things to inference,
and this version says them outright:

- The game **boots** with the animation loop driving it. A build whose start-up path
  leaves it on the manual clock never advances for a player, whatever it does when
  stepped. This was always the intent; it is now written down, and it is what
  `advances-in-real-time` grades.
- A **control operation may** switch to manual stepping too. Posing a situation and
  then stepping it is the usual reason to call one, and holding the clock keeps the
  pose exact — so the spec no longer implies, by listing only `reset` and `step`, that
  a build must leave the wall clock running through a pose. `setAutoStep(true)` hands
  it back either way.
- **Injecting input never** changes which clock drives the game. Keys are how a person
  plays, so a match started from the title with injected keys advances itself exactly
  as it would for a player. `advances-in-real-time` now relies on this directly, which
  is reason enough for the spec to promise it rather than merely imply it.

The `debug-api` point gains three assertions covering the handover the whole surface
rests on. Being installed as a function said nothing about `setAutoStep` working, and
nothing else graded it: a build whose `setAutoStep` is an inert stub answers every
other point correctly — they all drive the game with `step` — while every recorded clip
of the run comes out a frozen frame. The point now walks the clock through running,
stopped and running again (`setAutoStep(true)`, `step`, `setAutoStep(true)`), reading
real elapsed simulation time at each stage. Each reading is graded against the state the
one before it established, because either direction otherwise passes on a clock that
was already where the operation should have put it — a build whose `startMatch` held the
clock would "prove" that `step` stopped it without the clock ever having run.

## Scoring

The common checklist gains one point (weight 1) in the **Pause** category (`resume`), so
this version's total declared weight differs from `v2.1.0` and a score computed against
one is not directly comparable with the other. No point was removed, and no existing
item's `id`, `weight`, `domain`, `reference`, `proof`, or validation script path moved.

`resume` is the one point here that raises the bar on what a build must **do** rather
than on what it is checked against: the seeded specification now requires both routes
out of a pause, where it previously required neither, so a build that provides only one
of them loses this point. That is deliberate — how faithfully a build follows the
specification is what this case measures, and a requirement no two builds read the same
way measures nothing. All four runs recorded against `v2.0.1` fail it, and `v2.1.0` left
the pause wording exactly as they found it.

The rest touch existing points without adding any. `advances-in-real-time` is decided by
a repaired script at the same path, grading the same requirement — a build that
legitimately satisfied it before satisfies it still; `debug-api` grades three more
assertions within the same point and the same weight, and its checklist wording names
the clock handover they cover; `countdown-frozen`, `ball-continues` and
`respawn-collision` are decided by repaired scripts at their own paths, each grading the
requirement it always named; and the seeded `specs/instrumentation.md` states the clock
rules above, which resolve inferences rather than change what a build must do.
