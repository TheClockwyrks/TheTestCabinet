# Engines

An **engine** is the runtime a produced game is built on. It owns the frame loop
and the delta time it hands the game, the input actions a player drives the game
with, the audio bus, the asset loader, and the on-screen diagnostics. Some
engines also own rendering and a gameplay framework of their own.

An engine is a **run dimension**: it is selected per run alongside the test case,
variant, harness, and model, and it defaults to `none`. A case declares only the
engines it *supports*, and a run naming an engine outside that set is rejected
before any container work begins. An engine documents itself from its own
package, so a case's specs state only what is specific to that game.

Each built-in engine lives here, one directory per engine, named with its stable
slug.

```
engines/
├── none/engine.toml        # the baseline: the build supplies its own runtime
└── simple-2d/engine.toml
```

The built-in engines are embedded into `crates/core` at build time, so a
backend-driven worker (which has no local checkout) resolves them the same way as
the CLI.

The authoritative design lives at
[`components/core/engines.md`](../apps/docs/src/content/docs/components/core/engines.md);
the per-engine catalogue is under
[`engines/`](../apps/docs/src/content/docs/engines/).

## Manifest

Each `engine.toml` declares:

| Field | Meaning |
| --- | --- |
| `slug` | Stable slug; must match the directory name. |
| `name` | Human-readable name, shown by `tcab engines`. |
| `description` | What the runtime provides, for display. |
| `package` | Optional npm package providing the runtime. Absent for an engine that vendors no runtime. |
| `handle` | Optional `window` property the host interface is installed on. |
| `docs` | Optional directory inside the package holding the documentation seeded into the run workspace. |

## The runtime

A manifest is the **declarative** half of an engine: its identity and where its
runtime comes from. The runtime itself is an ordinary npm package in this
repository at `packages/<slug>/`, built with the rest of the npm workspace and
staged into the same host package store as the
[shippable packages](../containers/README.md#the-shippable-test-cabinet-packages)
by [`scripts/stage-tcab-packages.mjs`](../scripts/stage-tcab-packages.mjs).

At seed time the core copies the selected engine and its `@test-cabinet` closure
out of that store into `.tcab/engine/` inside the run repository, copies the
manifest's `docs` directory to `engine/`, and writes the dependency into the
seeded workspace's `package.json` as a relative `file:` spec. The build imports
the engine as an ordinary installed dependency, and the relative path resolves
wherever the produced tree later lives. This is the one place the harness edits a
build's `package.json`; a case's declared `packages` are declared by the
workspace the case ships.

## Versions

An engine's version is the `version` field of its staged `package.json`. It is
read out of the store at seed time and recorded on every run alongside the engine
slug, so the run identifies the exact runtime it was given. Bump the package
version whenever the engine's contract changes, so a run recorded against an
earlier version still names what that run received.
