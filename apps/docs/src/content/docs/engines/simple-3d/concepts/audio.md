---
title: Audio
---

The engine owns sound. A game declares a cue under a name while it initializes
and plays it by that name from its update; the audio graph, the mute state, the
listener, and the first-gesture unlock a browser requires sit below the name
and belong to the engine.

A cue is either synthesized from a description or backed by a produced audio
file. Both are declared during initialization and both are played by name, so
the simulation reads the same either way. A cue of either kind plays
unpositioned or at a point in the world, and that choice is made at each play
site rather than at the declaration.

## Synthesized cues

A synthesized cue is one oscillator through one gain node. The waveform is
chosen per cue, the frequency sweeps linearly from a starting value to an ending
value across the cue's duration, the gain decays from a peak to silence over that
same span, and both nodes stop when the duration ends.

That is the entire synthesis model. Five numbers describe a bleep, a rising
chime, or a falling thud, which is the vocabulary a game needs. A produced game
gets its sound without shipping a file and without spending any of its build
effort on oscillators, gain envelopes, or the autoplay policy.

## File-backed cues

A cue may instead name an audio file, resolved under the
[asset root](/engines/simple-3d/concepts/assets/) and decoded once during
initialization. This is how a game plays sound the asset-generation tools
produced: a case that generates its own effects or music binds each produced file
to a cue name, and the simulation plays that name exactly as it plays a
synthesized one.

Both kinds share one namespace, so replacing a placeholder bleep with a produced
file changes the declaration and leaves every play site alone. Declaring a name
that already holds a cue replaces it, which is what lets a sound be retuned
mid-run.

## Looping cues

A cue played once ends on its own. A cue looped sounds until the game stops it,
which is what an engine hum, a held thruster, or a music bed needs. A
file-backed cue loops its decoded buffer seamlessly, and a synthesized cue holds
its waveform at its starting frequency and its gain, so the same five numbers
that describe a bleep also describe a drone.

A cue is either looping or not. Starting a loop that is already running does
nothing, and stopping one that is not running does nothing, so a game drives a
loop from its state on every frame without counting starts against stops. Each
transition is announced once, as `cue:looped` when the loop starts and
`cue:stopped` when it ends.

A loop belongs to the cue name. Redeclaring a looping name stops the loop, mute
silences and restores every running loop in place, and a loop requested before
the unlock is looping from that moment and begins to sound when the context
opens. Destroying the engine stops every loop.

## Positional cues

A cue played or looped with a world point is positioned. The engine routes it
through a panner at that point, and the player hears it from where the camera
stands, attenuated by its distance and panned by its direction. A cue played
without a point is unpositioned and sounds as it does in 2D, at the bus's gain
and centered. The same declared cue serves both, so a clank sounds from the hook
it belongs to during play and from nowhere in particular on a menu screen.

The panner's model is fixed by the engine: inverse distance from a reference
distance of one world unit with a rolloff of one, a maximum distance of ten
thousand, and HRTF panning. Fixing it is what makes a positioned cue read the
same in every build. One world unit away sounds at the cue's gain and two units
away at half, so a game places its sounds in the same units it places its
objects in and tunes nothing per cue.

A positioned one-shot keeps the point it was played at for its duration. A
positioned loop is moved with `place`, which is what a motor on a moving crane
needs, and a loop started without a point stays unpositioned for its life. The
event a cue emits carries the point it was placed at, or `null`, so an observer
sees where a build put a sound as well as that it played.

## The listener is the camera

The listener is the camera as it stood at the most recent render, the same
reading the [view](/engines/simple-3d/concepts/camera-and-view/) answers from.
The engine writes the listener's position and orientation from that reading
every frame, so a loop placed at a fixed point moves across the stereo field as
the camera turns, and a game poses the ear by posing the eye.

Taking the listener from the camera rather than from a position the game
supplies is what keeps sound and picture agreeing. A cue at a world point is
heard from where it is seen to be, and a game whose camera follows the player
hears the world from the player's place with no second pose to keep in step.

## Muted and unlocked

The bus carries two bits, because a silent game is silent for one of two very
different reasons.

Muted is a decision the game or the player made. Unlocked records that a user
gesture reached the engine, which is what a browser demands before it will start
an audio context at all. The engine listens for the first pointer or key event on
its surface and opens the context there, once, so a build supplies no gesture
handler and no enable-sound screen of its own.

Keeping the two bits apart is what lets a silent build be diagnosed. A muted bus
is the build behaving as asked. A locked bus is an environment nothing has
clicked yet, which says nothing about the build. A single bit covering both would
read the same for a working game and a broken one, so the unlock is also
announced as the `audio:unlocked` event and a caller watching a build come up
sees the moment the context opened.

## Audio never fails a frame

A browser that refuses a context, or one whose context dies partway through a
run, degrades the bus to one that accepts cues, announces them, and sounds
nothing. The frame proceeds unchanged, and a panner that throws while a cue is
placed is contained the same way.

Playing, looping, stopping, or placing a cue that was never declared raises an
error. Silence is the expected outcome of a muted or still-locked bus, so a
mistyped name would otherwise be indistinguishable from a cue that played
inaudibly, and the mistake would survive to the end of the run unnoticed.

## Cues are observed as they play

Each play emits a `cue:played` [event](/engines/simple-3d/apis/game/) carrying
the name, the time it played at, the gain it played at, and the world point it
was placed at, or `null` for an unpositioned cue. The payload is semantic: it
states that a named cue happened and where, so it reads identically under a
muted engine, a still-locked bus, and a browser with no audio at all. A muted
play is announced at a gain of zero, which keeps the mute visible and keeps a
game that reacted to an event while muted distinguishable from one that never
reacted. The gain announced is the gain the cue was played at, before the
panner's distance attenuation, so the figure describes the build's decision
rather than the listener's distance.

Delivery is synchronous, inside the play. A subscriber therefore runs while the
frame that played the cue is still running, and can attribute the cue to that
frame's counter, respond to it, or count it against a frame it holds.

A subscription is what audio observation needs, in place of a record the engine
accumulates. An engine-owned log would have to keep every cue of every run
against the chance that something reads it, which grows for as long as the game
plays. A subscription keeps the engine's memory flat and puts the shape of the
record with the code that wants one, so a check that needs the last few cues
keeps a fixed-capacity buffer of its own and a check that needs a count keeps an
integer.

## Cue time is frame time

A cue's timestamp is the loop's accumulated simulated time, so it lines up with
the frame counter and with the simulated time everything else is expressed in.

That is what keeps the timestamp meaningful under a scripted
[clock](/engines/simple-3d/apis/clocks/). Frames stepped through
`engine.advance` run back to back and no real time passes, so wall-clock stamps
would put every cue of a several-hundred-frame advance at the same instant. Read
against the frame clock, a cue's time says which frame of the simulation it
belongs to, and an ordering assertion over cues becomes an assertion about the
game's behavior over its own timeline.
