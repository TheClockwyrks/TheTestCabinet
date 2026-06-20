# Fathom — Murk mode

This file defines the **Murk** mode, which sits alongside the standard Trench
mode. It builds on the standard mode in `specs/modes/standard.md` and overrides
one rule from `specs/sensing.md`; everything else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `MURK`

Place it after `DIVE` and before `HOW TO PLAY`.

## Mode

- **Murk** — the same dive as Trench, but the water is so thick with silt that
  **light scatters and bends around corners**, just like sound. This is the more
  forgiving way to read the dark.

**Override (passive vision).** In Murk, your passive light uses the **same
corridor-flood propagation as the sonar pulse** instead of line of sight: a tile
is lit by your passive light when it is an **open** tile within your vision range
of the forager **measured through the corridors** (a flood through open tiles),
rather than within straight-line sight. Concretely, replace the line-of-sight
test in `specs/sensing.md` with a flood from the forager's tile through open tiles
out to a path range of **`V_tiles = 3` tiles** at rest, growing to **`5` tiles**
at full brightness (`V_tiles = 3 + 2 * G`, rounded). So in Murk you **can** see
around the corner you are standing next to — passive light and sonar now obey the
same one rule.

Everything else is exactly as in Trench (`specs/modes/standard.md`): the omni
sonar pulse, brightness, the cooldown-based unlimited ink, all three predators,
and the scoring, lives, and depth scaling. Only how your **passive light**
propagates changes.

The mode label shown in the HUD (see `specs/playfield.md`) during a Murk dive is
`MURK`.
