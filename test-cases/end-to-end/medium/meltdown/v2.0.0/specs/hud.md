# Meltdown — The build panel

The build panel is the strip down the right of the stage, and it holds every
readout and every control the game offers. This file defines what it draws. Where
each element sits inside the strip is the build's own layout choice.
`specs/controls.md` states how each control is operated.

## The status readouts

The panel draws three readouts at all times during a run:

| Readout | Label | What it shows |
| --- | --- | --- |
| Money | `HUD_MONEY_LABEL` (`MONEY`) | The current money. |
| Lives | `HUD_LIVES_LABEL` (`LIVES`) | The lives remaining. |
| Wave | `HUD_WAVE_LABEL` (`WAVE`) | The current wave number over the run's total. |

Each readout follows its value as it changes. In a build phase the panel also
draws the seconds left on the build timer, falling as the timer does. In The
Hundred, which runs one onslaught rather than a numbered progression, the wave
readout reads the onslaught in place of a wave over a total.

## The shop

The shop lists all eight towers, one entry per type, in the shop order of
`TOWER_TYPES`: Arc, Stutter, Rime, Flak, Bloom, Lance, Forge, Sink. Each entry
draws that tower's name and its build cost.

An entry whose build cost is above the current money is drawn disabled, plainly
apart from an affordable entry.

## The info panel and the inspector

One area of the panel shows tower information. It has three contents:

- With a shop entry hovered, that type's information at level I.
- With a placed tower selected, that tower's live information.
- With neither, the next-wave preview below, where the phase draws one.

Both the hover panel and the inspector draw the tower's size, its range, its
damage or its effect, its fire rate, its targeting, its mass, and its radiator
faces. Each also names the tower type it is drawn for.

The inspector draws four things the hover panel does not: the tower's level, its
live heat read, its kill tally, and its total damage dealt. It also offers two
actions, Upgrade drawn with its cost and Sell drawn with its refund, and it
offers no rotate action, because a placed tower's orientation is fixed.

### The damage read

An emitter's damage read shows its live per-shot damage beside its live heat
multiplier, so a player watches the multiplier climb with the heat and hold flat
once the heat reaches the redline.

A selected Rime shows its live slow percentage where another emitter shows a
damage read. That is a display convention of this panel and nothing more; a
Rime's shots deal ordinary damage, as `specs/combat.md` states.

### The targeting read

Both the hover panel and the inspector read what the tower fires on. Every
emitter but the Flak reads as hitting ground and air, the Flak reads as air-only,
and the Forge and the Sink read as never firing.

## The next-wave preview

In the `opening` phase or a build phase, with nothing selected and no shop entry
hovered, the information area draws the coming wave's type and its count. The
`wave` phase draws no preview: the wave is already on the floor.

The Hundred's onslaught fields more than one type, so its preview reads as mixed
rather than naming one, alongside the count.

## The placement controls

While a placement is armed the panel carries two more controls:

| Control | What it does |
| --- | --- |
| Rotate | Turns the held preview one step, as `specs/building.md` states. |
| Cancel | Disarms the placement, clearing the held preview. |

Both are drawn only while a preview is held, and neither is drawn with nothing
armed.

## The wave controls

The panel carries a Send control, which reads Start while the phase is `opening`,
a game-speed toggle drawing whether the speed is `1` or `2`, a Pause control, and
a mute control.

The mute control reads plainly differently muted and unmuted, and its read
changes on the frame the mute state does, whichever way it was changed.

## Touch targets

Every control the panel carries is at least `MIN_TOUCH_TARGET` (`32`) by `32`
logical units and lies inside the panel's strip.

## The reads on the floor

Two reads are drawn on the floor rather than in the panel:

- Each placed tower carries a heat read on its footprint whose extent tracks its
  heat, with a marker at the tower's redline.
- Each surge unit carries a health bar above it whose extent falls as its hp
  does.
