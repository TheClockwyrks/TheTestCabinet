---
title: Writing Workspaces and Reference Implementations
---

## Overview

A playable case ships two projects for each engine it supports. The seeded
workspace is the project a run starts from, and the reference implementation is
the case's own conformant build of that project. The rules on this page apply to
every [end-to-end](/testing/end-to-end/overview/) and
[full-stack](/testing/full-stack/overview/) case on every engine, including
[no engine](/engines/none/).

The two projects are one project at two stages. A reference implementation is
the seeded workspace with the build's source, its tests, its showcase, and a
committed lockfile added, so the two share a toolchain and the configuration
that toolchain runs under. The
[manifest reference](/testing/end-to-end/manifests/#the-starter-project) states
which key names each directory; this page states what goes in them.

## The seeded workspace

### What a workspace contains

A workspace holds the project a model opens and nothing that belongs to a
finished build. Under an engine it also carries the entry stub the engine's
module contract requires and the `src/constants.ts` the specification's figures
are seeded in.

| File | Holds |
| --- | --- |
| `package.json` | The build interface, the toolchain scripts, and the project's dependencies |
| `tsconfig.json` | The TypeScript options the produced code compiles under |
| `vite.config.ts` | The bundler configuration, with `base: './'` so the built site loads from a page-relative URL |
| `vitest.config.ts` | The reporter and coverage settings a run reads its results from |
| `eslint.config.js` | The lint rules the `lint` command applies |
| `.prettierrc.json` | The formatting options the `format` command checks against |
| `.prettierignore` | What the `format` command leaves alone |
| `.gitignore` | The build artifacts kept out of the published per-run repository |
| `index.html` | The document the built site loads |

Hidden entries are skipped at seed time apart from an allowlist, so the two
prettier files and `.gitignore` reach a run while a hidden lint configuration
would not. ESLint's flat `eslint.config.js` seeds as an ordinary file.

### Engineless workspaces ship configuration only

A case's `none` workspace supplies configuration alone: a `package.json`, tool
configuration, and an `index.html`, with no source code. The model owns as much
of the code as possible, which is the point of the engineless configuration.

### Declare an inert icon in `index.html`

Use `<link rel="icon" href="data:," />` in seeded `index.html` files. Omitting
this results in 404 errors getting reported in the console, which validators may
detect and fail on.

### The workspace describes the game alone

A model must not learn that it is being evaluated, and the workspace carries
that rule with the specs. Its `index.html`, its `package.json`, and its tool
configuration name the build's own files and its entry point, so what the model
opens describes the game and nothing else. See
[Keeping evaluation out of the seeded set](/guides/authoring/writing-case-specifications/#keeping-evaluation-out-of-the-seeded-set).

## The reference implementation

### One conformant build per engine

A reference implementation is the case's authored answer: a complete, conformant
build of one variant on one engine, built with the case's own `[build]` commands
and never seeded into a run. A case supporting three engines carries three of
them per variant, because the build a reference demonstrates differs under each
runtime.

The reference is what `tcab capture-baselines` drives, what `tcab
publish-reference` deploys, and the tree a case's validators are developed
against. A validator asserts the specification rather than the reference, as
[Validators assert the specification, not the reference](/guides/authoring/writing-debug-apis-and-validators/#validators-assert-the-specification-not-the-reference)
covers.

### It starts from the seeded workspace

A reference begins as a copy of the workspace for its engine and adds what a
finished build holds: the source under `src/`, the build's own tests, the
showcase, and a committed `package-lock.json`. It keeps the seeded tool
configuration, so the rules a run is held to are the rules the reference is held
to.

A reference may extend that configuration where it owns something a run's tree
does not. The case's validator projects are developed inside the reference, so
its `eslint.config.js` carries the gates that keep a suite from reaching into
the build's `src/` for a figure it should transcribe.

### It is its own npm project

A reference is installed from its own directory rather than as a member of the
repository's npm workspace, and an engine-backed one resolves its engine through
a relative `file:` dependency. The repository root must be installed and built
first, as
[Reference implementations](/development/building/#reference-implementations)
covers.

### It carries the least its showcase validator needs

A case requiring showcase media validates only that the media exists. The
reference therefore carries the description, the carousel manifest, and one small
file the carousel names. The media a case presents is captured once into the
variant's `showcase/<variant>/` directory, which is the copy every surface
renders.

## The shared toolchain

### The four commands

A workspace's `package.json` declares the four scripts the case's `[toolchain]`
table names, and a reference declares the same four. The table's sample values
are the commands themselves:

```toml
[toolchain]
typecheck = "npx tsc --noEmit"
lint = "npx eslint ."
format = "npx prettier --check ."
test = "npx vitest run --coverage"
```

A run's copies of these commands are recorded on the run record, with
`typecheck` gating the run's rating. See
[The TypeScript toolchain](/testing/end-to-end/manifests/#the-typescript-toolchain).

### Prettier and ESLint are configured in both projects

Every seeded workspace and every reference implementation configures both tools:
a `.prettierrc.json`, a `.prettierignore`, an `eslint.config.js`, `prettier` and
`eslint` among the project's development dependencies, and the `format` and
`lint` scripts above. A project missing any of them leaves the `format` or
`lint` command with nothing to run under, and the run's recorded figure says
nothing about the code.

### Both tools ignore what the build did not write

The lint and format configuration covers the `.ts` and `.js` files a run holds:
the ones the workspace seeded and the ones the build wrote. Both ignore
directories holding something else, so the recorded figures describe the model's
own code:

| Ignored | Holds |
| --- | --- |
| `node_modules/` | Installed packages |
| `dist/`, `build/`, `out/` | Build output |
| `coverage/` | The report files a run reads its results and coverage from |
| `.vendor/` | The vendored engine and the case's vendored packages |
| `assets/` | The files a full-stack build produced as build inputs |
| `specs/` | The seeded specification |

Markdown is left to its own linter, so a case's authored prose stays as the case
wrote it. `npm run lint:specs` covers it on the authoring side.

### Neither tool runs on the specification

The `specs/` directory is seeded reading material rather than the project's
source, so both `.prettierignore` and the `ignores` list in `eslint.config.js`
name it. A tool that reached the specs would report a finding against files the
build never wrote and cannot act on, and the run would record a `format` or
`lint` failure that says nothing about the model.

## What must pass, and where

| Project | `format` | `lint` |
| --- | --- | --- |
| Reference implementation | Passes | Passes |
| Seeded workspace | Passes | Passes, apart from what the missing code causes |

A reference implementation is the case's own answer, so both commands run clean
against every one of them. A workspace's seeded files are authored the same way
and are formatted, so `prettier --check` passes there as well.

ESLint is the one place a seeded workspace is allowed to report. An engine
workspace ships the entry stub its module contract requires, and a stub whose
body the model has yet to write can leave a binding unused or a branch
unreachable. A finding that traces to that missing code is the workspace working
as intended, and every other finding is a defect in the seeded files and is
fixed. An engine workspace is likewise not expected to type-check before the
model has written the code its stub is missing.

## Checklist

When you finish authoring or revising a case's workspaces and references,
confirm each of the following.

- Every seeded workspace and every reference implementation ships a
  `.prettierrc.json`, a `.prettierignore`, and an `eslint.config.js`, with
  `prettier` and `eslint` among its development dependencies.
- Every one of them declares the four toolchain scripts its `[toolchain]` table
  names.
- Both `.prettierignore` and `eslint.config.js` ignore `specs/`, along with the
  installed packages, build output, report directories, vendored code, and
  produced assets.
- `prettier --check .` and `eslint .` both pass in every reference
  implementation.
- `prettier --check .` passes in every seeded workspace.
- Every finding `eslint .` reports in a seeded workspace traces to code the model
  is expected to write.
- Each engine's reference starts from that engine's workspace and keeps the
  seeded tool configuration, extending it only for what a run's tree does not
  hold.
- Every reference commits a `package-lock.json` and installs from its own
  directory with the repository root built first.
- Each engineless workspace contains configuration only.
- Every seeded `index.html` declares an inert icon.
- The workspace's `index.html`, `package.json`, and tool configuration name the
  build's own files alone.
- A reference required to carry showcase media carries the least its existence
  validator needs.

## Next steps

- [Writing case specifications and prompts](/guides/authoring/writing-case-specifications/)
  covers the seeded specs and the rendered prompt.
- [Writing debug APIs and validators](/guides/authoring/writing-debug-apis-and-validators/)
  covers the instrumentation the validators drive.
- [Publishing a reference implementation](/guides/devops/publishing-a-reference-implementation/)
  covers building a reference and recording its deployed URL.
