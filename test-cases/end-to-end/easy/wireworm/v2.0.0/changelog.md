This release adds a required **debugging and automation surface** to the game, so
it can be driven and inspected from code rather than only by hand, and reworks the
reviewer checklist into automatically validated categories. It is a new, mandatory
deliverable, hence the major version bump. How Wireworm plays is unchanged: the
board, the charge and discharge model, the worm, the three foes, scoring, and the
12-level run are as before.

## New: the `window.__wireworm` debug API and overlay

A new common spec, `specs/instrumentation.md`, requires the build to expose a small
debugging and automation API on `window.__wireworm` and a read-only debug overlay:

- **Deterministic, steppable, manual-clocked core.** The core simulation is
  render-free (state advances by stepping it, with no dependence on the canvas or
  wall-clock time), all randomness runs off a seedable generator, and the game
  holds a manual clock: `reset` and `step` drive the simulation forward one
  measured slice at a time, and `setAutoStep` lets it run live again, so a scripted
  scenario is exact and reproducible regardless of machine load.
- **`window.__wireworm`** — core operations `reset(options)`, `step(seconds)`, a
  JSON-serializable `snapshot()` (the full board: screen and phase, score, lives,
  level, the cursor, every node's charge, every worm's segments and headings, every
  foe, bolts, and discharge arcs), and `setAutoStep`, plus control operations that
  set up a scenario through the game's real systems: `startRun`, `setLevel`,
  `setScore`, `setLives`, `setCursor`, `setNode`, `clearField`, `setWorm`,
  `spawnFoe`, and `fire`.
- **Input injection** — `keyDown(code)`, `keyUp(code)`, and `press(code)` drive the
  game through the same handling the real keyboard feeds, so a caller can navigate
  the menus, start a run, pause, toggle mute, move the cursor, and fire exactly as a
  player would.
- **Debug overlay** — a read-only on-screen display of the live internal state,
  toggled with the backtick key, off by default, never affecting gameplay.

## Specification cleanup and reorganization

The specification is reorganized around Wireworm's own concerns and rewritten to be
fully self-contained: `specs/playfield.md` becomes `specs/board.md`; `specs/flow.md`
is split into `specs/progression.md` (lives, levels, victory, scoring) and
`specs/screens.md` (game states, the main menu, the HUD, and audio); and the
single-mode `specs/standard.md` is folded into `specs/screens.md`. The specs are
tightened throughout: prior-version and edge-case call-outs are removed (the edge
cases they named are now reviewer checks), and the prompt no longer prescribes a
verification pass, leaving whether to drive the built game with the installed
Playwright and Chromium to the model's judgment.

## Reviewer checklist reorganized into automatically validated categories

The reviewer checklist moves to the categories grammar, grouped by concern (Charge,
Worm, Cursor, Foes, Progression, Controls, Color, UI, and Audio), with each graded
point a narrowly scoped sub-item worth one point. Most mechanical points are now
decided automatically: a debug script drives the real simulation through
`window.__wireworm` to establish a precondition, steps the real systems forward, and
reads the outcome back from `snapshot()` or the rendered pixels, synthesizing the
proof media for each. A missing or non-conformant debug API fails the run outright.
The subjective points, art, feel, window fit, and audio, remain judged by a person.
