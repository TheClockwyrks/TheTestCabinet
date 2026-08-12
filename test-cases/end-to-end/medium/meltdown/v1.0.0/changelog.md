Introduced.

## The validation scenarios force the engagement they depend on

Every check that needed an emitter to actually shoot at something used to roof the left
vent with two rows of Sinks and call the rows below it a corridor. That works only if the
surge starts inside the corridor, and `specs/playfield.md` fixes the two ends of a
left-vent unit's journey without fixing the route between them, so it was never
guaranteed: a build that spawns a unit on a vent tile the roof covers drops it out
*above* the corridor, where the floor is wide open, and it walks the length of the map
several rows clear of a gun that never sees it. The check then reported the emitter as
broken.

The scenery is now a gate: a wall of Sinks running the full height of the floor with a
two-row gap in front of the emitter under test. The exhaust is on the far side of it and
those two rows are the only open tiles in it, so every route, on every pathfinder, from
every spawn tile, files past the gun. The trip, the bake, the splash, the bounty, the
targeting, the fire rate, the inspector tallies, the Flak's air-only rule and the Core's
slow immunity all rest on it, and each asserts the wall went up before it reads anything
else.

## Two thermal checks pin their own starting point

Nothing sets the build's clock until `arrange` has returned — the runtime takes it on the
arrange/act boundary — so which clock runs during `arrange` is whatever the build was left
on. `specs/instrumentation.md` has `reset` switch the game to manual stepping, and a build
that honors that is exact from the first pose; a build that only switches on `step` still
has its animation loop running, and its simulation advances in real time through every
round trip `arrange` makes. Both play identically for a person, and the difference shows
up only in the few milliseconds between the last pose and the handover.

That window is nothing to most scenarios and a great deal to `forge.warms`, where a
level-I Forge drives its neighbor at 129.6 heat per second: one 60 Hz tick is 2.16 heat
against a tolerance of 0.01. The check read that as "the emitter did not start cold" and
failed a working Forge, intermittently, depending on whether a frame happened to land.
`cooling.open-faces-shed` has the same shape with far more headroom.

Both now re-pose their heat at the top of `act`, once the runtime holds the clock — where
`setHeat` consumes no time and nothing can move between the pose and the reading, so the
starting point is exact by construction on every build. `forge.warms` also asserts the
RISE rather than the endpoint, which is what "a Forge warms a cold gun" claims, with a
coarse bound on the start that still rules out a vacuous pass. Widening the tolerance
instead would have blinded the check to a Forge that starts its neighbor warm, which is
the one thing the reading is there to catch.

## "The game advances itself" is checked through the door a player uses

`controls.advances-in-real-time` is the one item that cannot advance the simulation
itself —
its whole subject is whether the build's own frame loop does — so it poses a match and
then
measures real elapsed time. It posed that match with the debug `startGame`, on the
reasoning
that a control op only arranges the world.

That reasoning has a hole in it. `specs/instrumentation.md` names exactly two operations
that
hand the clock to manual stepping: "`reset` and `step` already switch to manual on their
own".
A build whose `startGame` also switches to manual is then frozen for this check and for
nobody else — its menus start the clock as they always did, so a person plays it perfectly
happily, and only a caller who came in through the debug door sees a dead floor. The item
reported "the game does not advance itself" about a game that advances itself, which is
the
one thing it must never do.

The fix is not to special-case that operation but to stop using the debug door at all.
What
this point scores is a claim about the game a *person* opens, so the check now opens it
the
way a person does: genuine browser-trusted key events through the build's own menu
handling —
title, mode, difficulty — until the match is live, with no `reset`, `startGame`, `step` or
`skip` anywhere in it. The clock under observation is the one a player gets, reached by
the
route a player takes.

The original hunt is intact, and was re-proved against two mutants of the reference: one
whose
frame loop renders but never advances the simulation, and one that boots on the manual
clock
with no menu path that hands it back. Both still fail. What no longer fails is a build
that is
merely fussy about which door you came in by.

Real input brought its own wrinkle worth recording: a build may queue input and drain the
queue once per animation frame rather than acting on the event itself, which the reference
does — so reading the state straight after a keypress sees the state *before* it, and the
navigation walked out of step with itself. Each press now waits for the frame that
consumes
it, which is simply the gap between keystrokes a real keyboard has and an injected one
does
not.

## The death cue is measured over four shots, not one

`audio.death-cue` cannot ask which source in the audio log is which, so it differences two
windows in which the emitter fires the same number of shots — at a target that survives
them, and then at targets that do not. Holding the shot counts equal is what makes the
firing cue cancel, and that only works if firing is deterministic per shot. Nothing says
it
has to be: `specs/ui.md` asks for a cue when an emitter fires, and thinning a gun that
fires several times a second is a reasonable thing to do. One build plays its firing cue
on
a per-shot coin flip, and with a single shot in each window the control could land a
firing
cue that the kill window did not — so a death cue worth exactly one failed to exceed it,
about one run in fourteen, decided by nothing but chance.

Each window is now four shots rather than one. The counts stay equal, so a per-shot firing
cue still cancels and still cannot fake a death cue; the signal is four kills against the
difference of two small binomials, and the check asks the kill window to lead by two
rather
than by any amount at all — which also stops a build with no death cue slipping through on
one lucky flip.

The windows are matched the other way round from how that first sounds: the kills run
first, and the control is then asked for exactly as many shots as the kills actually
landed. Fixing the number in advance left the premise brittle — a Mote occasionally died a
beat before its shot was counted, the kill window came up one short, and the item failed
on
the premise while its real verdict passed cleanly. Matching the control to the kills makes
the two equal by construction whatever a given run manages. The kills are fed in one at a
time, too, since a Lance takes 1.25 s between shots and four Motes released together
outlive their turn.

## The cue checks listen where a player does

A cue is played by a presentation layer reading events the simulation emitted, and the
specification puts that firmly on the rendering side of its own architecture: `step`
"advances firing, heat, cooling, conduction, movers, surge movement, pathing, and the
build-phase and wave timers" — a list of simulation systems, with audio nowhere on it —
and
`specs/gameplay.md` requires the sim be "decoupled from rendering" with "rendering only
read[ing] the state". So a build is free to raise its cues from its frame loop rather than
from inside `step`, and one that does is following the architecture the spec asks for.

The eight cue checks drove with `step` and then asked what had played. On a build that
raises cues from its frame loop that reports silence for a game whose cues all work —
which
is what happened: six of the eight failed a build whose audio is fine, because its debug
`step` discards the queued events its frame loop would otherwise have played. The
reference
happens to drain cues inside `step`, which is why the checks ever worked; they had quietly
encoded that one valid choice as though it were the requirement.

Each check now hands the clock to the build for the window it counts, and lets its own
frame
loop run the simulation and play the sound. The approach to each event stays on `skip`, so
only the measured window costs real time.

Making that reliable took more than the swap, and each of these was a real defect the
change
exposed rather than a tolerance to widen:

- **The handover is not a normal frame.** The sim has been on the manual clock for the
  whole of `arrange`, so the build's loop comes back to a large accumulated delta and
  catches up in one go. On one build that first frame ran a full second of firing at once,
  taking a pair of cold Stutters from 0 heat to 98 — over the redline on the very poll a
  window opened on, so the rest of it was silent by design. `giveClockToBuild` now spends
  that burst before anything is measured, and scenarios pose their state and release their
  targets after it.
- **Baselines must be read before the state is posed.** `audioSettled` settles before it
  reads, and the build's clock runs through that — long enough for a tower posed near its
  redline to fire, trip and play its cue *inside* the baseline, swallowing the very cue the
  window existed to count.
- **Windows compared against each other must hold the same number of shots.** At a
  250 ms poll a 7/s Stutter fires nearly twice per read, so the trip check's "one shot"
  windows silently held four against one and the extra firing cues alone cleared the
  assertion — it passed a build whose trip cue had been deleted outright. Both windows are
  now exactly one shot, from a Lance slow enough that a poll cannot contain two, with its
  heat held against its own cooling so the shot lands on the heat that was asked for. The
  death cue runs its kills first and then asks the control for exactly as many shots, so the
  two are equal by construction however many the run managed.

The result was checked the way it should have been all along: eight mutants of the
reference,
each with exactly one cue deleted. Every item fails when its own cue is gone and passes
when
any other is — a clean diagonal, which the previous design did not achieve.

## Audio checks give the build a frame to play the cue in

The validate pass advances the simulation instantly, so a check that read the Web Audio
log on the tick its event happened gave the build no wall clock at all — and a build that
raises its cues from its render frame, or rate-limits a firing cue against
`AudioContext.currentTime`, had scheduled nothing yet. Both are conformant ways to build
it. Every audio read now settles first, and arming audio settles too, so a freshly
created context is genuinely running before anything measures what it has played.

Two of the cue scenarios were wrong in their own right as well. The trip cue posed a
tower's heat straight to 100, which is a debug pose rather than a trip the game caused —
a build is free to put the tower into its cooldown from `setHeat` while raising the cue
from the thermal update a real trip goes through — so the tower now trips the way it
trips in play, by firing itself over the redline, measured against one ordinary shot.
The Victory sting took its control from the final wave itself, which assumed that wave
fields more than one unit; on a build that sends a single Core the first leak *was* the
win, so the control window swallowed the sting. It now controls against a plain leak and
against the mid-run milestone wave's clear.

## Rotation's thermal consequence is scored once, not twice

`rotation.changes-outcome` made the same claim as `cooling.radiator-better` — that in the
same spot, with the same faces blocked, a radiator face on the open air cools better than
a plain one — and differed only in how many faces it blocked. It is gone. The Rotation
category keeps the control (a quarter turn aims the faces; the choice is locked at
placement) and the thermal consequence stays with surface cooling.

That surviving comparison now blocks its faces with Forges held above their setpoint
rather than with Sinks. A Sink sheds far more per edge than any face does, so although it
cancelled — both sides carried the same pair — it compressed the difference the rotation
makes into a couple of points on a bar that was plunging anyway. A Forge above its
setpoint adds exactly nothing, so the whole of the difference on screen is the faces, and
the gap is around fifteen points instead of two.

## `place-stays-armed` is about placing, not about the debug shorthand

The item also required the `placeTower` shorthand to leave a preview held. That is a fair
reading of the debug contract and it is not what the review point claims, which is the
`specs/controls.md` sentence about what happens on the floor when a player clicks — so a
build whose pointer path keeps its placement armed correctly could fail a checklist point
about its own in-game behavior. It now arms once and lays a run of three copies, which
is the behavior the sentence describes.

## The mute control shows its state

`specs/ui.md` now requires the mute toggle to read on screen as on or off. A recorded clip
carries no audio track, so without something visible there was nothing for a review of the
mute control to look at, and no way for a player to tell a muted game from one whose audio
failed to start.

## The clips show the behavior they are named for

A pass over every item's media. Stills that could not carry their claim became clips — the
damage plateau (one number climbing while another holds), a tripped tower *strobing*, the
Rime's slow fading as its own firing warms it, its ceiling rising through three upgrade
levels, a deep-wave unit absorbing shots that killed a wave-1 one, the game speed applying
to the whole floor, the mute control before and after. Clips that cut on the frame their
subject arrived got a beat afterwards, most visibly the trip cooldown, which ended six
seconds of a dead tower just as it came back. Clips that opened after their subject had
already happened got a beat before: the pause keys now have a unit walking to freeze, a
boxed emitter is hot and visibly online before the surge arrives, and the hotkeys cycle
the shop over three seconds instead of inside one frame.

Where the evidence is a comparison, both halves are now on screen together — the Sink
against open air, and a level-III Sink against a level-I one, side by side on one floor
rather than either side of a cut. Where it is a progression, each step gets its own frame:
one still per difficulty, one per upgrade level, Deep Pockets' opening balance as well as
its balance after a clear. Where it is a refusal, the held footprint is in the frame in
the
color the spec names for it, inside and outside a Bottleneck build zone and stopped
against the casing at the floor's edge. And where the tower's own readouts *are* the
subject, the tower is selected, so the inspector is open on them.

## The reference implementation's `movePreview` moves the pointer

`specs/instrumentation.md` has `movePreview` move the held preview "exactly as moving the
mouse over the floor does", and the reference wrote the preview straight into its game
state instead. The placement preview is rebuilt from the pointer on every frame, so that
lasted exactly one snapshot: correct for any check reading `snapshot().build`, and gone
before anything was drawn. Every still meant to show a footprint hovering somewhere — a
sealing placement being refused, a build-zone boundary, a tower held against the casing —
showed the preview parked wherever the real cursor sat, which under an automated driver is
the top-left corner of the stage. It now drives the pointer, which also brings the debug
path under the same keep-it-on-the-grid clamp the mouse already had.

## The pause freeze is measured on the clock a player is on

`pause.freezes` paused the match and then advanced, on the reasoning that a paused
simulation ignores the advance. But an advance is the debug API's `step`, and where a build
puts its pause gate is its own business: the reference closes it inside the simulation's
own update, while a build that holds the pause in the shell that drives the clock — feeding
its simulation no time at all while the menu is up — freezes the floor just as completely
for the player and steps right through the check. `specs/instrumentation.md` does not
settle it ("stepping only advances the live game; it has no effect on a menu screen", and
the pause menu is a required menu over a screen that is not the live one), so the item was
scoring a free choice. One such build walked its Mote 180 px through the pause while the
clip filmed for the same item — in real time, where the freeze is real — showed it stopping
dead behind the menu. The verdict contradicted its own evidence.

It was the weaker check in the other direction too, and that matters more: a build whose
pause menu opens over a floor that keeps running passes the old check outright, so long as
its `step` is gated. The one thing the item exists to catch was the one thing it could not
see.

The freeze is now watched in real time, with the clock in the build's hands and nothing
stepping it, over two windows of the same length: the Mote must genuinely walk in the
first, and hold its position — with the simulation clock stopped alongside it — through the
second. The running window is what keeps the freeze from passing vacuously, since a dead
floor is also a still one, and it is the contrast the item's clip was always named for.
Proved with three mutants: a reference that simulates through its pause fails, one that
simulates through its pause only when a player is driving (and so passed the old check)
fails, and one whose floor never advances at all fails the running window instead.
