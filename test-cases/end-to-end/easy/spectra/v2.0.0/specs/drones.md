# Spectra — The three drones

This file defines the three drone kinds and what each one asks of the band system.
The phases, the entrance, the formation, the dive, and the fire a dive carries are
the same for all three and are in `specs/swarm.md`. What a matching and a mismatched
shot do is in `specs/bands.md`.

There are exactly three kinds: the Shard, the Flux, and the Prism. None can be
captured, turned, or made into an ally.

## The Shard

The fixed-band drone and the bulk of every formation.

- Its band is set when it is created and never changes on its own for the rest of
  its life.
- One shot whose effective band matches destroys it.
- It takes exactly one shot over a dive.
- It is drawn at a footprint of `SHARD_SIZE` (`28`), with a contact half-extent of
  `SHARD_HALF` (`14`).

## The Flux

The oscillating drone. It alternates between the two bands on a telegraphed rhythm,
so it can only be destroyed on the right beat.

### Its rhythm

A Flux carries a stored band and a band clock, and the two are separate fields.

- The stored band is the band the Flux is holding, or, mid-shimmer, the one it is
  leaving.
- The band clock is how far the Flux is into its **current band window**, in
  seconds, running from `0` to `fluxWindow(stage)`. It advances with game time.

A band window is `fluxWindow(stage) = fluxHold(stage) + FLUX_SHIMMER`, with
`fluxHold(stage)` the hold `specs/stages.md` states and `FLUX_SHIMMER` (`0.4`)
seconds. The window runs in two parts.

| The band clock | The Flux is |
| --- | --- |
| Below `fluxHold(stage)` | Holding its stored band |
| At or above `fluxHold(stage)` | Shimmering, settled on neither band |

When the band clock reaches `fluxWindow(stage)`, the Flux's stored band flips to the
opposite one and the band clock returns to `0`, starting the next window. A full
cycle back to the same stored band is therefore
`fluxCycle(stage) = 2 * fluxWindow(stage)`. Nothing else changes the stored band,
and nothing else moves the band clock.

While it shimmers, the Flux reads as the band it is moving toward, which is the
opposite of the one it stores.

### What that means in play

- A shot whose effective band matches the Flux during a held part of the window
  destroys it.
- No shot destroys a shimmering Flux, of either band.
- A Flux takes exactly one shot over a dive, carrying the band it stores at the
  moment of the shot. It fires nothing while it shimmers: a Flux that is shimmering
  when it crosses the fire line takes its shot as soon as it settles on a band, if
  it is still diving.
- It is drawn at a footprint of `FLUX_SIZE` (`30`), with a contact half-extent of
  `FLUX_HALF` (`15`).

## The Prism

The large two-band drone that anchors a wave and swaps the field if it gets through.

### Its two layers

A Prism wears an outer shell of one band around an inner core of the other. The
shell's band is the Prism's stored band, and the core's is always the opposite. The
shell hides the core until the shell is gone, so exactly one layer is exposed at a
time.

| The Prism | The exposed layer | Broken by |
| --- | --- | --- |
| Shell intact | The shell | A shot whose effective band matches the shell's |
| Shell broken | The core | A shot whose effective band matches the core's |

Breaking the shell leaves the Prism alive with its core exposed; destroying the
exposed core destroys the Prism. Each layer falls to a single matching shot, and a
shot of the other band breaks neither. A Prism can be broken while it rests in the
formation, not only while it dives.

- With its shell intact it is drawn at a footprint of `PRISM_SIZE` (`56`), with a
  contact half-extent of `PRISM_HALF` (`28`).
- With only its core left it is drawn at `PRISM_CORE_SIZE` (`26`), with a contact
  half-extent of `PRISM_CORE_HALF` (`13`).

### Its escort

A Prism enters the wave with `PRISM_ESCORTS` (`2`) Shards, one of each band, flying
in alongside it before taking their own slots. The escort travels with the Prism's
entry group.

### Its fire

A diving Prism takes exactly two shots over its dive, fired together as it crosses
the fire line, one carrying each band, so it threatens the ship whichever band the
ship is tuned to.

### The spectral inversion

A Prism that survives its dive to the bottom of the field swaps the whole field's
bands rather than being destroyed there.

- When a diving Prism with a layer still intact has its center cross
  `PRISM_INVERT_Y` (`640`) travelling downward, it triggers a spectral inversion as
  `specs/bands.md` states, and it enters phase `returning` and heads back toward its
  slot.
- The Prism itself is unharmed by that crossing, and it may dive again later.
- A Prism the discharge wave reaches is destroyed whole before it can reach that
  line, as `specs/resonance.md` states.
