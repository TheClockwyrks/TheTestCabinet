Introduced.

Meltdown ships with a required debugging and automation surface so the game can be
driven and inspected from code, and its reviewer checklist is grouped into categories
whose points are decided automatically where a machine can judge them.

## The `window.__meltdown` debug API and overlay

A common spec, `specs/instrumentation.md`, requires every build to expose a small
debugging and automation API on `window.__meltdown` and a read-only debug overlay:

- A deterministic, steppable core. The fixed-timestep simulation the controls spec
  requires is also render-free (state advances by stepping it, with no dependence on
  the canvas or wall-clock time) and its randomness runs off a seedable generator, so a
  scenario replays identically. `step(seconds)` and `reset()` switch the game to manual
  stepping so a scripted scenario is exact and reproducible; `setAutoStep(true)` hands
  the clock back to the animation loop to run live.
- Control operations that set up a scenario through the game's real systems: starting a
  game in any mode and difficulty, adjusting money, lives, and the wave clock, building
  and managing towers through the real placement/upgrade/sell code, setting a tower's
  heat as a starting point, and spawning surge into the real pathing and combat
  systems.
- Input injection (`keyDown`, `keyUp`, `press`) that drives the keyboard accelerators
  through the same handling the real keyboard feeds, so the controls themselves can be
  exercised.
- A read-only debug overlay of the live internal state, toggled with the backtick key,
  off by default, never affecting gameplay.

The surface is framed throughout as an ordinary developer affordance of the game.

## Self-contained specification

The specification is decomposed into files named for this game: `specs/reactor.md`
(the floor geometry, formerly playfield), `specs/surge.md` (the intruders, formerly
creeps), and `specs/economy.md`, `specs/waves.md`, and `specs/states.md` (the run,
split by concern). Each seeded file reads as one self-contained game, with no history
or cross-version framing and no test-facing language. The prompt notes that the
project's Playwright and Chromium are available for driving and validating the build
but leaves whether to use them to the model's judgment.

## Categorized, auto-validated reviewer checklist

The reviewer checklist is grouped into categories, with each graded point a narrowly
scoped item worth one point. Items a machine can judge carry a validation script that
drives the real, deterministic simulation through `window.__meltdown`, decides the
verdict, and captures side-by-side media; the points still judged by a person (feel,
art, audio, and how each screen reads) carry no script.
