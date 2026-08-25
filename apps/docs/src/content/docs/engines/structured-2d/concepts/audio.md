---
title: Audio
---

The engine owns sound. A game declares a cue under a name and plays it by that
name from a tick; the audio graph, the mixing, the mute state, and the
first-gesture unlock a browser requires sit below the name and belong to the
engine.

A cue is either synthesized from a description or backed by a produced audio
file. Both are declared by name and both are played by name, so the simulation
reads the same either way.

## Synthesized cues

A synthesized cue is one oscillator through one gain node. The waveform is
chosen per cue, the frequency sweeps linearly from a starting value to an ending
value across the cue's duration, the gain decays from a peak to silence over
that same span, and both nodes stop when the duration ends.

That is the entire synthesis model. Five numbers describe a bleep, a rising
chime, or a falling thud, which is the vocabulary a 2D game needs. A produced
game gets its sound without shipping a file and without spending any of its
build effort on oscillators, gain envelopes, or the autoplay policy.

## File-backed cues

A cue may instead name an audio file, resolved under the [asset
root](/engines/structured-2d/concepts/assets/) and decoded once when it is
declared. This is how a game plays sound the asset-generation tools produced: a
case that generates its own effects or music binds each produced file to a cue
name, and the simulation plays that name exactly as it plays a synthesized one.

Both kinds share one namespace, so replacing a placeholder bleep with a produced
file changes the declaration and leaves every play site alone. Declaring a name
that already holds a cue replaces it, which is what lets a sound be retuned
mid-run.

## Looping cues

A cue played once ends on its own. A cue looped sounds until a tick stops it,
which is what an engine hum, a held thruster, or a music bed needs. A
file-backed cue loops its decoded buffer seamlessly, and a synthesized cue holds
its waveform at its starting frequency and its gain, so the same five numbers
that describe a bleep also describe a drone.

A cue is either looping or not. Starting a loop that is already running does
nothing, and stopping one that is not running does nothing, so an actor or a
game mode drives a loop from its state on every tick without counting starts
against stops. Each transition is announced once, as `cue:looped` when the loop
starts and `cue:stopped` when it ends.

A loop belongs to the cue name, and so to the engine rather than to the world
currently open: it runs across a level transition until a tick stops it.
Redeclaring a looping name stops the loop, mute silences and restores every
running loop in place, and a loop requested before the unlock is looping from
that moment and begins to sound when the context opens. Destroying the engine
stops every loop.

## Cue definitions live on the engine

A cue is a fact about the game, not about the world currently open. Definitions
therefore sit on the engine and survive a level transition, so a name declared
during initialization plays in every level that follows and a level opens with
its whole vocabulary already live.

That placement keeps a shared sound declared once. A hit, a pickup, and a menu
confirmation belong to the game, so they are declared during initialization and
every level plays them by name. A level that carries sound nothing else uses
declares that cue in its own `load`, which the engine awaits before the world is
built, so the level's first frame can play it.

## Muted and unlocked

The bus carries two bits, because a silent game is silent for one of two very
different reasons.

Muted is a decision the game or the player made. Unlocked records that a user
gesture reached the engine, which is what a browser demands before it will start
an audio context at all. The engine listens for the first pointer or key event
on its surface and opens the context there, once, so a build supplies no gesture
handler and no enable-sound screen of its own.

Keeping the two bits apart is what lets a silent build be diagnosed. A muted bus
is the build behaving as asked. A locked bus is an environment nothing has
clicked yet, which says nothing about the build. The unlock is also announced as
the `audio:unlocked` event, so a caller watching a build come up sees the moment
the context opened.

## Playing an undeclared cue is an error

Playing, looping, or stopping a cue that was never declared throws, naming the
cue. Silence is the expected outcome of a muted or a still-locked bus, so the
throw is what distinguishes a mistyped name from a cue that played inaudibly,
and the run itself reports the mistake on the frame that made it.

## Cues are observed as they play

Each play emits a `cue:played`
[event](/engines/structured-2d/apis/audio/) carrying the name, the time it
played at, and the gain it played at. The payload is semantic: it states that a
named cue happened, so it reads identically under a muted engine, a still-locked
bus, and a browser with no audio at all. A muted play is announced at a gain of
zero, which keeps the mute visible and keeps a game that reacted to an event
while muted distinguishable from one that never reacted.

This is what establishes that a build sounded a cue in response to something
that happened. A subscriber holding the collision, the score change, or the
level transition it was watching for sees the cue arrive against the same frame,
so the claim under check is that the game responded rather than that a speaker
moved.

Delivery is synchronous, inside the play. A subscriber therefore runs while the
frame that played the cue is still running, and can attribute the cue to that
frame's counter, respond to it, or count it against a frame it holds. A
subscription also keeps the engine's memory flat over a run of any length, and
puts the shape of the record with the code that wants one.

## Playback belongs to a tick

An actor, a component, a controller, and a game mode all reach the bus through
the world they belong to, and each plays from its own tick. What a frame sounds
is therefore decided by the same code that advanced the simulation, at the point
where the event that warrants the sound was detected.

The rendering pipeline plays nothing. A frame's picture is produced from the
world the ticks settled, and a frame's sound is produced by the ticks
themselves, so a redraw of an unchanged world is silent.

## Cue time is frame time

A cue's timestamp is the loop's accumulated simulated time, so it lines up with
the frame counter and with the simulated time everything else is expressed in.

That is what keeps the timestamp meaningful under a scripted
[clock](/engines/structured-2d/apis/clocks/). Frames stepped through
`engine.advance` run back to back and no real time passes, so wall-clock stamps
would put every cue of a several-hundred-frame advance at the same instant. Read
against the frame clock, a cue's time says which frame of the simulation it
belongs to, and an ordering assertion over cues becomes an assertion about the
game's behavior over its own timeline.
