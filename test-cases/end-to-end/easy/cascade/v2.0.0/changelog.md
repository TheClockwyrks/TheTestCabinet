This release adds a required **debugging and automation surface** to every
variant, so the game can be driven and inspected from code rather than only by
hand, and reworks the reviewer checklist around automated validation. The debug
surface is a new, mandatory deliverable, hence the major version bump.

## New: the `window.__cascade` debug API and overlay

A new common spec, `specs/instrumentation.md` (seeded for every variant), requires
the build to expose a small debugging and automation API on `window.__cascade` and
a read-only debug overlay:

- Deterministic, seedable, render-free core. The deal shuffle and the victory
  cascade's launches run off a seedable generator, so a scenario replays
  identically, and game state advances with no dependence on the canvas or
  wall-clock time. Normal play still seeds the deal from a non-deterministic source
  each new game.
- `window.__cascade`. Core operations `reset(options)` (with `options.seed`),
  `newGame()`, `step(seconds)`, a JSON-serializable `snapshot()` of the full board
  and cascade state, and `setAutoStep(enabled)`. Control operations arrange a board
  and drive the real rules: `setBoard(state)` places an exact board as a
  precondition, `turnStock()` runs the real stock turn or recycle, `move(source,
  target)` attempts a real move through the game's own legal-move check, and
  `autoMove(source)` performs the double-click auto-move.
- Pointer-input injection. `pointerDown`, `pointerMove`, `pointerUp`, `click`, and
  `doubleClick` drive the game through the same pointer handling the real mouse
  feeds, so a caller can navigate the menus, turn the stock, and drag a card across
  the table exactly as a player would.
- The deterministic manual clock. The victory cascade is the game's only
  time-driven system; an `autoStep` flag (default on for human play) governs whether
  the animation loop advances it from the wall clock or `step(seconds)` advances it
  by hand, so a scripted cascade is exact and reproducible.
- Debug overlay. A read-only on-screen display of the live internal state (screen,
  deal mode, pile sizes, the current drag, and the cascade's progress), toggled with
  the backtick key, off by default, never affecting gameplay.

The `specs/overview.md` hard-requirements list and file map, the `prompt.hbs` build
instructions, and `specs/proof.md` are updated to match. The surface is framed
throughout as an ordinary developer affordance of the game. The prompt notes that
the project's Playwright and Chromium are available for driving and validating the
build, but leaves whether to use them to the model's judgment rather than mandating
a verification pass.

## Reviewer checklist reorganized into categories with automated validation

The reviewer checklist is now grouped into categories in the categories grammar
(`[review] format = 2`), with every graded point a one-point item. Most points
carry a `validation` script that drives the build through `window.__cascade` and
decides its own verdict, arranging a board and running real moves for the rules
points, injecting pointer drags for the drag-and-drop points, stepping the victory
cascade for the animation points, and sampling the rendered canvas for the color
points. The deal, foundation, tableau, run, stock/waste, auto-move, win-detection,
and victory-cascade behaviors are each checked more finely than before, so a build
fails exactly the rule it breaks. Presentation points (window fit, card legibility,
the read of each screen) remain judged by eye.

## Reference implementations

Both reference builds, **draw-one** and **draw-three**, implement the new
`window.__cascade` API and the debug overlay, with a seedable deal and cascade RNG
and the full board-and-cascade snapshot the checks need.

## Specification cleanup

The seeded specs were tightened and renamed to natural names for this game:
`layout.md` became `table.md`, `flow.md` became `states.md`, and `cascade.md` (the
win animation) became `victory.md`. Historical and edge-case call-outs were removed
and emphasis pared back, so each variant's seeded set reads as one self-contained
game. The deal-mode spec is still seeded per variant to the stable
`specs/deal-mode.md`.

## Otherwise unchanged

Nothing about how Cascade plays changed: the deal, the rules of play, the stock and
waste, win detection, and the victory cascade are as in the previous version.
