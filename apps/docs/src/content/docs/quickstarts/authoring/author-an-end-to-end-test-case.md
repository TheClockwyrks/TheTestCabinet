---
title: Author an End-to-End Test Case
---

## Scope

Scaffold an [end-to-end](/testing/end-to-end/overview/) test case: a playable
game a model builds from a seeded specification. Read
[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
and
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
first. They are the full procedure and the editorial rules for what goes into the
seeded specs and the prompt.

## Layout

A version lives at `test-cases/end-to-end/<difficulty>/<slug>/<version>/`. A
version with runs recorded against it is frozen; revise a case by adding a new
version.

```text
test-cases/end-to-end/<difficulty>/<slug>/<version>/
  test-case.toml       # manifest: build, toolchain, engines, specs, checklist, domains
  variants/            # one standalone TOML file per variant
  workspaces/          # one starter project per engine; seeded to the run root
  prompt.hbs           # rendered into the harness instruction; not seeded
  changelog.md         # required per-version entry; not seeded
  description.md       # site blurb; not seeded
  specs/               # the specification, decomposed by concern; seeded
  references/          # reference implementations, one per engine; not seeded
  validation/          # the validator suites, one directory per engine; not seeded
  assets/              # art the model must use; seeded (omit if none)
```

## Steps

1. Pick an original in-game title such as `Carom`. The catalog slug is its
   kebab-cased form, `carom`. The case must be inspired by rather than a clone of
   its source, and must play with no API keys and no backend.
2. Fix the coordinate system, what must be visible on each screen, and the
   states and screens in the overview spec. Every other spec leans on those;
   palette, type, and layout stay the build's choices.
3. Decompose the specification into focused seeded files that cross-reference
   each other by name: overview, playfield, physics, flow, instrumentation, and
   one spec per mode. Keep the set
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications),
   so it stands alone without the reference source and links to nothing outside
   itself.
4. Mandate [instrumentation](/testing/end-to-end/instrumentation/) in a spec of
   its own: a debug API on a case-specific global, a render-free core, and a
   read-only debug overlay. Frame it as an ordinary debugging feature of the
   game. Every review point declares a `validation` script, which requires the
   case to declare an `[instrumentation]` handle.
5. Write `prompt.hbs`. It renders in strict mode against `{{workspace}}`,
   `{{variant.*}}`, `{{engine.*}}`, `{{#each specs}}`, and
   `{{time_limit_hours}}`. A spec template sees `{{version}}`,
   `{{variant.*}}`, and `{{engine}}`.
6. Author one reference implementation per engine under `references/<engine>/`
   and declare the set in each variant's `[reference_implementation]` table.
   Each is built with the case's `[build]` commands and passes the toolchain
   gates; none is seeded.
7. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`), the
   required `changelog`, the required `[build]` and `[toolchain]` commands,
   `engines` with `[[engine]]` ranges and one `[workspaces]` directory per
   engine, the `[instrumentation]` handle, the common `[[spec]]` and
   `[[domain]]` lists, and the review checklist with each point's
   `validation`, `domains`, and `failure_cap`. At least one `[[domain]]` is
   required. A spec's `dest` defaults to its `source` with a trailing `.hbs`
   removed.
8. Write the `variants` list of paths to standalone TOML files under `variants/`.
   It is a root key, so it must precede the first table header, and the first
   entry is the default variant.
9. Author the validator suites under `validation/<engine>/`, one script per
   review point per engine that point covers. A point covers every supported
   engine unless its `validation.engines` list names fewer. Run the suites
   against each engine's reference implementation with `tcab validate`, then
   capture the committed baselines into the `cold-storage` submodule with
   `tcab capture-baselines`.

`test-cases/end-to-end/easy/carom/v3.0.0/` is the worked example a new case
should resemble.

## Validate

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant> --engine <engine>
tcab seed   --test-case <slug> --version <version> --variant <variant> --engine <engine>
```

Run them for every variant and engine combination; `--engine` defaults to
`none`. `prompt` catches strict-mode template and manifest errors. `seed`
writes the seeded repository under `tmp/`, where you confirm the seeded set
resolves and is self-contained.

## Next steps

- [Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/)
  to add another mode.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
