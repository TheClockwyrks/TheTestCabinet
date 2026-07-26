# Spectra — The drones

This file defines the three drones: how each enters, holds formation, and dives,
how each behaves with polarity, the Prism's inversion, and what a wave is made of.
It builds on the stage and formation in `specs/playfield.md`, the polarity systems
in `specs/polarity.md`, the controls in `specs/controls.md`, and the wave flow in
`specs/gameplay.md`.

There are exactly three kinds of drone: the Shard, the Flux, and the Prism. None
can be captured, turned, or made into an ally; the only way through a wave is to
destroy them. Each is tuned to the two bands differently, and that difference is
its identity.

## Shared movement and states

Every drone is always in one of four states:

- Entering: flying in from off-screen along its entrance path to its assigned
  formation slot (below).
- In formation: sitting in its slot, riding the formation sway
  (`specs/playfield.md`).
- Diving: peeled off the formation on an attack run toward the player.
- Returning: looping back to re-enter its slot after a dive.

Drone bodies cost the player a life on contact, regardless of band
(`specs/polarity.md`). Drones get faster in later stages (see Stage scaling in
`specs/gameplay.md`); the speeds below are the stage-1 values.

When a drone is destroyed, play the provided drone-burst. Each pop throws the
seeded drone-burst detonation, the neon flash/ring/spark effect at
`assets/drone-burst.json`, played with the provided particle runtime, centred on
the drone's position and scaled to its footprint; `specs/assets.md` is the
contract for playing it. The Prism detonates twice: once when its shell is
destroyed and once when its core is (see The Prism). This is the per-drone pop
only. The screen-clearing discharge (`specs/polarity.md`) and the spectral
inversion (below) are separate effects drawn in code.

### Entrances (you design the paths)

At the start of a wave the formation is empty and the drones fly in:

- Drones enter in staggered groups (a new group launches about every `0.6 s`),
  each drone from off-screen above the play field (`y < 64`).
- Each follows a smooth curved path you design, a continuous sweeping arc or loop
  down to its slot. Paths may cross the upper field and curve back; they never
  teleport, and each ends with the drone settling into its slot and joining the
  sway.
- Entrance travel speed is about `260 px/s` along the path.

The entrance choreography is yours to author within these rules; aim for the
readable, deliberate swoop of a formation assembling, not a straight drop.

### Dives (you design the paths)

Once the formation has assembled, drones peel off to attack:

- Cadence. The first dive begins about `2.0 s` after the formation finishes
  assembling; thereafter a new dive (a single drone, or occasionally a pair)
  launches every `1.4 s` to `2.6 s`, chosen with some variation so the assault is
  unpredictable. Dives shorten in later stages (`specs/gameplay.md`).
- Path. A diving drone leaves its slot and follows a smooth swooping curve you
  design down through the field at about `300 px/s`. The path:
  - is continuous (no teleporting),
  - threatens the player, bending toward the player ship's `x` so it is a real
    attack, not a fixed track,
  - stays dodgeable, sweeping in rather than homing perfectly onto the player,
  - and ends by either looping back up to re-enter its slot, or exiting through the
    bottom (`y > 656`) and re-appearing from the top to fly back to its slot
    (continuous wrap, `specs/playfield.md`).
- A looping dive turns back before `y = 656`, so it never enters the bottom HUD
  strip; an exit-dive is the only thing that crosses it, and only in transit as it
  wraps.
- Firing. While diving, a drone fires 1 to 2 bullets of its current band straight
  down (you may bias the aim slightly toward the player's `x`) at `320 px/s`.
  Drones in formation do not fire; only divers do, which keeps the threat
  readable.

A drone that survives its dive returns to its slot and may dive again later.

## The Shard: the fixed-band drone

The Shard is the basic drone and the bulk of every formation.

- Band. Each Shard has a fixed band, cyan or magenta, set when it spawns and never
  changing. Formations are seeded with Shards of both bands (`specs/playfield.md`),
  so the player must flip to clear them.
- Behavior. Standard entrance, formation, and dive as above; fires 1 shot of its
  band per dive.
- Destroying it. One matching shot (a bullet of the Shard's band) destroys it; an
  opposite-band shot does not (`specs/polarity.md`, `specs/gameplay.md`).
- Look. A small crystalline drone (about `28 px`) in its band's color and glyph,
  rendered from the provided Shard sprite re-tinted to its band (`specs/assets.md`).

## The Flux: the oscillating-band drone

The Flux flickers between the two bands on a steady, telegraphed rhythm, so you
must shoot it on the right beat.

- Band. A Flux alternates its band on a fixed cycle: it holds one band for
  `1.6 s`, then shimmers for `0.4 s`, flickering between both colors and settled on
  neither, then emerges holding the other band, and repeats (a full cycle is
  `4.0 s`). The shimmer telegraphs the coming flip.
- Destroying it. A matching shot during a held window destroys it. During the
  shimmer the Flux has no settled band, so no shot destroys it; wait for it to
  settle. Read its rhythm and fire on the beat.
- Firing. While diving, a Flux fires shots of its currently held band; it does not
  fire during a shimmer.
- Look. A drone (about `30 px`) drawn in its current held band's color and glyph,
  visibly shimmering between both during the `0.4 s` telegraph. It is rendered from
  the provided Flux sprite: the mid-shimmer art during the telegraph, collapsed to
  the single held band otherwise (`specs/assets.md`).

## The Prism: the two-band boss drone

The Prism is the large anchor of a wave: a layered drone that must be broken in
two bands, in order, and that punishes you if it reaches you.

- Two layers, opposite bands. A Prism has an outer shell of one band over an inner
  core of the other band (the two layers are always opposite). The shell hides the
  core until the shell is gone.
- Destroying it, a two-band sequence. First destroy the shell with a shot of the
  shell's band; that strips the shell and exposes the core. Then destroy the core
  with a shot of the core's band (the opposite band). Each layer is a single hit
  but only to a matching shot; a mismatched shot does not break it. You can break a
  Prism while it sits in formation, not only while it dives. Only the core kill
  scores the Prism and feeds resonance (`specs/polarity.md`); the shell is worth
  its own smaller points (`specs/gameplay.md`).
- Escort. A Prism enters escorted by two Shards, one cyan and one magenta, flying
  in alongside it before taking their own slots.
- Firing. While diving, a Prism fires a two-shot burst, one cyan and one magenta,
  so it threatens you whichever band you are shielded as; mind both.
- Look. A large drone (about `56 px`): an outer ring/shell in the shell band's
  color and glyph around an inner core in the core band's, so its two bands read at
  a glance. Once the shell is gone, only the core remains. It is rendered from the
  provided Prism sprite, with the shell and core bands re-tinted to whichever bands
  this Prism carries (`specs/assets.md`).

### Spectral inversion: the Prism's threat

A Prism that is not broken in time does not just hurt you on contact; it can flip
the whole field:

- If a diving Prism (shell or core still intact) reaches the bottom of the play
  field (its body crosses `y = 640`), instead of being destroyed it triggers a
  spectral inversion and then returns toward its slot.
- For `5 s` after, the two bands are swapped across the entire field: every drone
  and every bullet that was cyan now counts and is drawn as magenta, and every
  magenta one as cyan. The displays update to the swapped colors and an
  unmistakable inversion overlay (a field-wide tint and a clear indicator) marks
  that the bands are flipped, so the field stays readable, but everything you had
  lined up is now the wrong band and you must re-read and re-tune the whole board
  on the fly.
- Only one inversion is active at a time; another Prism reaching the bottom
  refreshes the `5 s`. When it ends, bands return to normal.
- Counter. Break Prisms (shell then core) before they can complete a dive to the
  bottom. A discharge (`specs/polarity.md`) that catches a diving Prism destroys it
  outright (band-blind) and prevents the inversion.

## What a wave is made of

A standard wave's formation (you design its exact layout, within
`specs/playfield.md`) contains:

- Shards of both bands as the bulk of the formation;
- at least two Fluxes; and
- at least one Prism (more in later stages).

The total number of drones grows with the stage, up to the formation's slot
capacity (`specs/playfield.md`), and later stages lean more on Fluxes and Prisms.
The special challenge stages are different, a non-firing flyover, and are defined
in `specs/gameplay.md`.

## Reading the three at once

Each drone tests your polarity differently: the Shard is a fixed band you simply
flip to match; the Flux is a moving target in time you must catch on the beat; the
Prism is two bands in sequence that flips the whole field if you let it through. A
live formation mixes all three across both bands at once; that is the puzzle of the
swarm.
