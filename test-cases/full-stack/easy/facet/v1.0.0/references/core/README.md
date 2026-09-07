# Facet — the shared game core

This directory is Facet's whole game: the board, the ruleset R1–R9, the chain
step and its cadence, scoring, levels, the end of a round, the pointer targets,
the controls, the screens, and the logic behind the debug and automation
surface. It is written
**once** and copied verbatim into each of the three reference builds.

It imports nothing from an engine, a renderer, or a DOM. Hand it a state and a
delta time and it hands back the next state, which is what lets the same game
run on `simple-2d`, on `structured-2d`, and on no engine at all.

## Copying it into a build

```sh
mkdir -p <build>/src/core
cp references/core/*.ts <build>/src/core/
```

That glob is the whole of the contract, and it is why the harness's Vitest
config is `vitest.config.mts` rather than `.ts`: `*.ts` picks up the modules and
their `*.test.ts` files and nothing else. A build's own
`vitest.config.ts` already collects `src/**/*.test.ts`, so the core's tests run
as part of that build's suite with no further wiring.

Do **not** copy `package.json`, `tsconfig.json`, `vitest.config.mts`,
`eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `package-lock.json`,
or this file. They exist only so the core can be type-checked, linted,
formatted, and tested on its own, before any build is standing.

## The one thing it depends on

Every module imports the specification's figures from `../constants`. In a build
that resolves to `src/constants.ts`, which sits beside `src/core/` exactly as
`references/constants.ts` sits beside this directory — `references/constants.ts`
is the supplied constants file, kept here so the core type-checks and tests in
the same shape it has inside a build. The `simple-2d` and `structured-2d`
workspaces are seeded with that file; the `none` build, which is seeded with no
`src/` at all, takes a copy of it.

Nothing else is imported. There are no runtime dependencies at all.

## The modules

| Module        | What it holds                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `state.ts`    | `FacetState` and its resting values, the gem and board types, and the nine frame events the cues are played from. |
| `board.ts`    | Cell geometry, cell access, pointer targeting of a cell, and the board notation.                                  |
| `rules.ts`    | R1–R9 as pure functions of a board, plus scoring and the legal-swap search.                                       |
| `chain.ts`    | The swap in motion, the order a chain step resolves in, the `stepHold` cadence, and the level and end conditions. |
| `deal.ts`     | Dealing an opening board: no run under R4, and at least one legal swap.                                           |
| `targets.ts`  | Every screen's pointer targets, and the hit test that says which one a position lies in.                          |
| `controls.ts` | The board's press, move, and release tables, and the pointer's press, move, and release over a screen's targets.  |
| `flow.ts`     | The screens, their menus, and every transition between them.                                                      |
| `random.ts`   | The game's own random source, which the deal and the refill draw from.                                            |
| `debug.ts`    | The snapshot projection and the poses the debug surface is built from.                                            |
| `fixtures.ts` | Test support: the quiet board the tests are posed on.                                                             |
| `index.ts`    | The barrel a build imports from.                                                                                  |

## What a build still owns

The core stops where the machine starts. A build writes its own frame loop or
binds the engine's, its renderer, its audio, its asset loading, its diagnostics
sources, and the object it installs on `window.__facet` (or hands back from
`initialize`) — which wraps these poses, and adds the two operations that are
not poses at all, `setAutoStep` and `advance`, because a clock belongs to
whatever is driving the frames.
