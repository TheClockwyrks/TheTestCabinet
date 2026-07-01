# Fathom — Beam mode

This file defines the **Beam** mode, which sits alongside the standard Trench
mode. It builds on the standard mode in `specs/modes/standard.md` and extends the
sonar from `specs/sensing.md`; everything else is unchanged.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `BEAM`

Place it after `DIVE` and before `HOW TO PLAY`.

## Mode

- **Beam** — the same dive as Trench, but you carry **two kinds of sonar**: the
  loud omnidirectional pulse, and a tight **directional beam** you aim down the
  corridor ahead. Knowing which to use is the new skill.

**Extension (a second sonar).** In Beam you keep the omni pulse from
`specs/sensing.md` exactly as-is (control `Space`, range `E`, all directions,
loud), and you gain a second pulse:

- **Beam pulse.** Pressing **`F`** (off a separate **`4 s`** cooldown) emits a
  **directional** pulse that floods only **forward** — through the corridors
  leading away in the forager's current facing direction. It does not spread back
  toward or behind the forager: seed the flood from the tile immediately **ahead**
  of the forager and flood forward through open tiles, branching down corridors
  that lead onward, out to a longer path range of **`E_beam = 14` tiles**. It
  reveals and marks predators exactly like the omni pulse, but only in that
  forward region.
- **Quieter.** Because it is tight, the beam makes **less noise**: it attracts the
  Listener at about **half** the strength of an omni pulse (a shorter hunt window;
  see `specs/predators.md`), so it is the safer way to scout the route ahead when
  you already know where you are going. The omni pulse is still the one to use when
  you need to know what is on *every* side, and it is still the loud one.
- **HUD.** Show a second readiness gauge for the beam alongside the omni-sonar and
  ink gauges (`specs/playfield.md`).

Everything else is exactly as in Trench (`specs/modes/standard.md`): the fog,
line-of-sight passive light, brightness, the cooldown-based unlimited ink, all
three predators, and the scoring, lives, and depth scaling. Only the addition of
the directional beam changes.

The mode label shown in the HUD during a Beam dive is `BEAM`.
