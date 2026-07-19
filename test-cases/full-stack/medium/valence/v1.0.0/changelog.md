Introduced.

Valence ships with a required debugging and automation surface, so the game can be
driven and inspected from code rather than only by hand, and much of the review is
decided automatically.

## The `window.__valence` debug API and overlay

A common spec, `specs/instrumentation.md` (seeded for every variant), requires the
build to expose a small debugging and automation API on `window.__valence`, a
read-only debug overlay, and the deterministic core they rest on:

- Deterministic, steppable core. The tick loop already ran on a fixed timestep;
  `specs/instrumentation.md` also requires the core simulation to be render-free (state
  advances by stepping it, with no dependence on the canvas or wall-clock time) and any
  randomness (a round's wave, its spawn timing, path assignment, particle scatter) to
  run off a seedable generator, so a scenario replays identically. A manual clock
  (`autoStep`, toggled by `setAutoStep`) lets a scripted scenario advance the sim
  exactly, or hand the clock back to run and record live.
- `window.__valence`. Core operations `reset(options)`, `step(seconds)`, a
  JSON-serializable `snapshot()` (screen and phase, the economy, every path, and every
  live unit, tower, projectile, and effect), and `setAutoStep`, plus control operations
  that set up a scenario through the game's real systems: `selectMap`, `goToMapSelect`,
  `setEnergy`, `setIntegrity`, `setRound`, `startRound`, `spawnUnit`, `placeTower`,
  `upgradeTower`, `sellTower`, `selectTower`, `setTargeting`, `setInertPriority`, and
  `setSpeed`. Each arranges a precondition; the real simulation produces the outcome a
  check reads back.
- Input injection. `keyDown(code)`, `keyUp(code)`, and `press(code)` drive the game
  through the same handling the real keyboard feeds, so a caller can navigate the menus,
  start a round, pause, toggle mute, cycle speed, and use the tower and inspector
  hotkeys exactly as a player would.
- Debug overlay. A read-only on-screen display of the live internal state, toggled with
  the backtick key, off by default, never affecting gameplay.

The `specs/overview.md` hard-requirements list and file map, the `prompt.hbs` build
instructions, and `specs/proof.md` (which now notes that the debug API can set up the
exact state each capture needs) are all updated to match. The surface is framed
throughout as an ordinary developer affordance of the game. The prompt notes that the
project's Playwright and Chromium are available for driving and validating the build,
but leaves whether to use them to the model's judgment rather than mandating a
verification pass.

## Specs cleaned up

The economy/rounds/states/HUD spec was renamed from `specs/flow.md` to
`specs/campaign.md` to fit the game. The specs were tightened throughout: history and
prior-version framing removed, emphasis pared back, and edge-case call-outs turned into
plain rules so recognizing and handling them is the model's job.

## Reviewer checklist auto-validated

The reviewer checklist moves to the categories grammar, with the objective, mechanically
verifiable behaviors (map topologies and distribution, free placement and its refusals,
automatic targeting and priorities, bonds as chippable health, hit points and damage
types, the energy-immune decaying heavies, detection from its several sources and the
Moderator slow, the two-branch upgrades, the economy and integrity, the fragmenting
boss, and the in-place-vs-menu pause) driven and decided through the `window.__valence`
API against a deterministic core, with the run's actual media synthesized beside the
reference build's. The subjective half (the produced art, animation, particle bursts,
audio, HUD readability, and how each screen and map reads) stays a human judgement, and
the Reaction Systems and Presentation & Assets scoring domains are unchanged.
