# Spectra — Resonance and the discharge

This file defines the resonance meter, what fills it, and the screen-clearing
discharge it pays for.

## The meter

The resonance meter is a number from `0` to `RESONANCE_MAX` (`100`). A run starts
with it at `0`, and the bottom HUD strip shows it as `specs/ui.md` states.

Exactly two events fill it.

| Event                                                             | Adds                     |
| ----------------------------------------------------------------- | ------------------------ |
| The hull absorbs an enemy bullet of the ship's own band           | `RESONANCE_ABSORB` (`6`) |
| One of the player's bullets destroys a drone by matching its band | `RESONANCE_KILL` (`4`)   |

Breaking a Prism's shell adds nothing; destroying a Prism's exposed core is a
matching kill and adds `RESONANCE_KILL`.

Nothing else moves the meter.

- It caps at `RESONANCE_MAX`. An event that would carry it past the ceiling leaves
  it at exactly `RESONANCE_MAX`.
- It does not decay with time.
- Losing a life leaves it exactly where it stands.
- Spending a discharge is the only thing that lowers it.

## The discharge

A discharge is available exactly when the meter reads `RESONANCE_MAX`, and not one
point below.

The discharge action, which `specs/controls.md` binds, does one of two things.

| The meter             | The action                                              |
| --------------------- | ------------------------------------------------------- |
| At `RESONANCE_MAX`    | Sets the meter to `0` and starts the wave below         |
| Below `RESONANCE_MAX` | Does nothing: the meter is unchanged and no wave starts |

## The wave

A discharge wave is a circle centered on the ship. It is live for
`DISCHARGE_TIME` (`0.5`) seconds from the action, and over that time its radius
grows from `0` to `DISCHARGE_MAX_R` (`1500`). It reaches a thing when that thing's
center lies inside the wave's current radius.

The wave is band-blind: what band the ship holds, and what band a thing carries,
change nothing about what it takes.

| What the wave reaches                                 | What happens                                                |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| A drone in phase `entering`, `diving`, or `returning` | It is destroyed                                             |
| A Prism in one of those phases                        | It is destroyed whole, shell and core together, in one step |
| An enemy bullet                                       | It leaves the roster                                        |
| A drone in phase `formation`                          | Nothing                                                     |
| One of the player's bullets                           | Nothing                                                     |

Each drone the wave destroys pops as `specs/assets.md` states and scores as
`specs/scoring.md` states. When the wave's time runs out it stops, and the game
carries no wave until the next discharge.

Movement, firing, and the flip run as usual while a wave is live.
