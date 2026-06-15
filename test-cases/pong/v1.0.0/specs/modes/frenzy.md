# Carom — Frenzy mode

This file defines the **Frenzy** mode, a mode this build includes alongside the
standard modes. It builds on the standard modes in `specs/modes/standard.md`, the
physics in `specs/physics.md`, and the match flow in `specs/flow.md`.

## Menu entry

This mode spec adds the following entry to the main menu (see Game states in
`specs/flow.md`):

- `FRENZY`

Place it after the standard `SOLO` and `VERSUS` entries and before `HOW TO PLAY`.

## Mode

- **Frenzy** — same as **Solo** (human on the left versus the AI on the right,
  single ball, standard scoring and match flow), but the speed ramp is steeper
  and uncapped: each paddle hit multiplies ball speed by **1.08** with **no speed
  cap**. Frenzy is the fast, escalating variant; the rally ends quickly.

Everything else matches Solo from `specs/modes/standard.md`: the same AI
opponent, the same serve and scoring, and the same spin mechanic from
`specs/physics.md`. Only the paddle-hit speed rule changes — the `1.08`
multiplier with no `980 px/s` cap replaces the normal `1.04`/`980` rule for this
mode.

The mode label shown in the HUD (see `specs/flow.md`) during a Frenzy match is
`FRENZY`.
