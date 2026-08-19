---
title: Audio
---

The engine owns sound. A game declares a cue under a name during setup and plays
it by that name from its simulation; the audio graph, the mute state, and the
first-interaction unlock a browser requires all sit below the name and belong to
the engine.

Cues are synthesized rather than sampled. A produced 2D game gets its sound
without shipping audio files and without a build spending any of its effort on
oscillators, gain envelopes, or the autoplay policy.

## The synthesis model

A cue is one oscillator through one gain node. The waveform is chosen per cue,
the frequency sweeps linearly from a starting value to an ending value across
the cue's duration, the gain decays from a peak to silence over that same span,
and both nodes stop when the duration ends.

That is the entire model. Five numbers describe a bleep, a rising chime, or a
falling thud, which is the vocabulary a 2D game needs. Richer timbre is out of
scope.

Declaring a name that already holds a cue replaces its description, so a sound
can be retuned mid-run without the bus being rebuilt.

## Muted and unlocked

The bus carries two observable bits, because a silent game is silent for one of
two very different reasons.

Muted is a decision the game or the player made. Unlocked records that a user
gesture reached the engine, which is what a browser demands before it will start
an audio context at all. The engine listens for the first pointer or key event
on the document and opens the context there, once, so a build supplies no
gesture handler and no enable-sound screen of its own.

Keeping the two bits apart is what lets a silent build be diagnosed. A muted bus
is the build behaving as asked. A locked bus is an environment nothing has
clicked yet, which says nothing about the build. A single bit covering both
would read the same for a working game and a broken one.

## Audio never fails a frame

A browser that refuses a context, or one whose context dies partway through a
run, degrades the bus to a log-only bus. Cues continue to be accepted and
recorded, and the frame callback is unaffected.

The one condition that raises an error is playing a cue that was never defined.
Silence is the expected outcome of a muted or still-locked bus, so a mistyped
name would otherwise be indistinguishable from a cue that played inaudibly, and
the mistake would survive to the end of the run unnoticed.

## The cue log

Every play appends an entry to a cue log: the name that was played, the time it
played at, and the gain it played at. The record is semantic. It states that a
named cue happened, not anything about samples or the audio graph.

The log is what makes audio checkable. A headless browser produces no audible
output, so a play must leave a record behind. Because the record is a name
rather than a sound, the log reads identically under a muted engine, a
still-locked bus, and a browser with no audio support.

A muted play is recorded at a gain of zero rather than omitted. The mute stays
visible in the log, and a game that reacted to an event while muted stays
distinguishable from one that never reacted.

## Cue time is frame time

A cue's timestamp comes from the frame loop's clock, not the wall clock. It is
the loop's accumulated simulated time, so it lines up with the frame counter and
the simulated time a driver is already asserting against.

This is what keeps the log meaningful under a manual clock. A manual advance
runs its frames synchronously and no real time passes, so wall-clock stamps
would put every cue of a several-hundred-frame advance at the same instant. Read
against the frame clock, a cue's time says which frame of the simulation it
belongs to, and an ordering assertion over cues becomes an assertion about the
game's behaviour over its own timeline.
