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
  test-case.toml     # manifest: build, specs, references, checks, domains
  variants/          # one standalone TOML file per variant
  prompt.hbs         # rendered into the harness instruction; not seeded
  changelog.md       # required per-version entry; not seeded
  description.md     # site blurb; not seeded
  specs/             # the specification, decomposed by concern; seeded
  reference/         # mockup source, rendered to screenshots; not seeded
  assets/            # art the model must use; seeded (omit if none)
```

## Steps

1. Pick an original in-game title such as `Carom`. The catalog slug is its
   kebab-cased form, `carom`. The case must be inspired by rather than a clone of
   its source, and must play with no API keys and no backend.
2. Fix the coordinate system, palette, type scale, and screens in the overview
   spec. Every other spec leans on those.
3. Decompose the specification into focused seeded files that cross-reference
   each other by name: overview, playfield, physics, flow, instrumentation, and
   one spec per mode. Keep the set
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications),
   so it stands alone without the reference source and links to nothing outside
   itself.
4. Mandate [instrumentation](/testing/end-to-end/instrumentation/) in a spec of
   its own: a debug API on a case-specific global, a deterministic core, and a
   read-only debug overlay. Frame it as an ordinary debugging feature of the
   game. A `[[review_item]]` that declares a `validation` script requires the
   case to declare an `[instrumentation]` handle.
5. Write `prompt.hbs`. It renders in strict mode against `{{workspace}}`,
   `{{variant.*}}`, `{{#each specs}}`, and `{{time_limit_hours}}`. A spec
   template sees `{{version}}` and `{{variant.*}}`.
6. Author each reference view as self-contained HTML sharing a `theme.css`. The
   harness renders these to screenshots and seeds none of the source.
7. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`), the required
   `changelog`, the required `[build]` commands, the common `[[spec]]`,
   `[[reference]]`, and `[[domain]]` lists, the `[[review_item]]` checklist, and
   any opt-in `[[check]]`. At least one `[[domain]]` is required. A spec's `dest`
   defaults to its `source` with a trailing `.hbs` removed.
8. Write the `variants` list of paths to standalone TOML files under `variants/`.
   It is a root key, so it must precede the first table header, and the first
   entry is the default variant.

`test-cases/end-to-end/easy/carom/v2.0.1/` is the worked example a new case
should resemble.

## Validate

Run these for every variant.

```sh
npm run lint:specs
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template and manifest errors. `seed` writes the
seeded repository under `tmp/`, where you confirm the seeded set resolves and is
self-contained.

## Next steps

- [Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/)
  to add another mode.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end
  to end.
