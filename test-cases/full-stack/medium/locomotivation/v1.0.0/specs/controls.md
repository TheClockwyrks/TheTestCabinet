# Locomotivation — simulation and controls

## Fixed-timestep simulation

Run the game on a fixed timestep so movement, train schedules, and collisions are
deterministic: the same inputs from the same start always produce the same result.
Use a fixed simulation step of 60 Hz — a step of exactly `dt = 1/60 s` — with an
accumulator that decouples simulation from render frame rate; render interpolates
or simply draws the latest simulated state. The rate is fixed rather than a
suggestion, because `specs/instrumentation.md` advances the simulation in whole
ticks of it. All speeds and timings in these specs are in real
seconds and logical pixels per second (`specs/overview.md`).

Determinism matters for two reasons: it makes the train schedules learnable
(`specs/trains.md`), and it lets the game be stepped headlessly so you can drive and
inspect it from code (`specs/instrumentation.md`). Keep the core simulation
(movement, weight and speed, trains, collision, cargo, clock, lives, win and fail)
free of rendering and wall-clock timing so it can be stepped on its own.

## Keyboard controls

| Action | Keys | Notes |
| --- | --- | --- |
| Move | `W A S D` and Arrow keys | Hold to move in the four cardinal directions; sets the worker's facing (`specs/character.md`). No momentum. |
| Sprint | Hold `Shift` | A recharging fixed-duration burst; disabled while the load is over the ~80% threshold (`specs/character.md`). |
| Pick up | `E` (or `Space`) | Lift a package (a dispenser's ready package, or a unique or optional in the yard) when standing on or adjacent to it, if it fits under `W_max` (`specs/cargo.md`). |
| Drop | `Q` | Set down the most-recently carried package at the worker's tile (`specs/character.md`, `specs/cargo.md`). |
| Interact (lever) | `E` (or `Space`) | Toggle a junction lever when adjacent (`specs/trains.md`). |
| Deliver | (automatic) | Entering a color-matched drop zone delivers all carried packages of that color (`specs/cargo.md`). |
| Board last train | (automatic) | Stepping onto a rideable flat-top car boards it (`specs/trains.md`). |
| Pause | `Esc` | Opens the pause menu; pauses the clock and simulation (`specs/flow.md`). |
| Mute | `M` | Toggles all audio (`specs/assets.md`). |
| Menu navigation | Arrow keys / `W S` to move, `Enter`/`Space` to confirm, `Esc` to go back | For the title, level select, pause, and result screens. |

Pick-up and interact may share a key (`E`) since a lever and a package are never on
the same tile, or separate them. Document your final bindings in the
in-game How to play screen and the `README.md`. Pointer or mouse control is optional
and never required; the game must be fully playable from the keyboard.
