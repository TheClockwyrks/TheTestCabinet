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

No point was added or removed, and no existing item's `id`, `weight`, `domain`,
`reference`, `proof`, or validation script path moved, so this version's total declared
weight matches `v2.1.0` and a score computed against one is directly comparable with the
other.

`advances-in-real-time` is decided by a repaired script at the same path, grading the
same requirement — a build that legitimately satisfied it before satisfies it still;
`debug-api` grades three more assertions within the same point and the same weight, and
its checklist wording names the clock handover they cover; and the seeded
`specs/instrumentation.md` states the clock rules above, which resolve inferences rather
than change what a build must do.
