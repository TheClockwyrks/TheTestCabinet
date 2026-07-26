---
title: Author an End-to-End Test Case
---

Scaffold a new [end-to-end](/testing/end-to-end/overview/) test case — a playable
game built from a spec (or a new version of an existing one). This is the short
version; [Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
covers spec-writing and the rules in full, and
[End-to-End Tests](/testing/end-to-end/overview/) is the authoritative schema.

Drawing a sprite rather than building a game? See
[Author an Asset-Generation Test Case](/quickstarts/authoring/author-an-asset-generation-test-case/)
instead — it is a different test type with a different manifest.

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml     # manifest: common specs, references, checks, domains
  variants/          # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs         # rendered into the harness instruction (NOT seeded)
  specs/             # the specification, decomposed by concern — SEEDED
  reference/         # mockup source, rendered to screenshots — NOT seeded
  assets/            # sprites etc. the model must use — SEEDED (omit if none)
```

## Steps

1. Pick an original **in-game title** (e.g. `Carom`); its catalog **slug** is
   the kebab-cased title (e.g. `carom`). The case must be inspired by but **not a
   clone** of its source, and must need no API keys and no backend to play.
2. In the overview spec, fix the **coordinate system**, **palette/type**, and
   **screens** every other spec leans on.
3. Decompose the spec into focused, seeded files that cross-reference each other
   **by name** (overview, playfield, physics, flow, an
   [instrumentation](/testing/end-to-end/instrumentation/) spec, plus mode specs).
   Keep them
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications):
   no links outside the seeded set, no dependence on the reference source.
   Mandate the [instrumentation](/testing/end-to-end/instrumentation/) a run is
   validated through — a debug API on a case-specific global, a deterministic
   core, and a read-only debug overlay — framed as an ordinary debugging feature
   of the game, never as something for grading.
4. Write `prompt.hbs` using only the documented template variables
   (`{{workspace}}`, `{{variant.*}}`, `{{#each specs}}`) — it renders in strict
   mode.
5. Author each reference view as self-contained HTML sharing a `theme.css`; the
   harness renders these to screenshots. Never seed the source.
6. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`), the required
   `[build]` commands, the common `[[spec]]`/`[[reference]]`/`[[domain]]` lists, a
   `variants` list of paths to standalone variant files under `variants/` (a root
   key, so it must precede the first table header; first = default), and any opt-in
   `[[check]]`. A spec's `dest` defaults to its `source`.

[Authoring an End-to-End Test Case](/guides/authoring/authoring-an-end-to-end-test-case/)
is the full procedure to follow while doing this, and
[Writing Case Specifications and Prompts](/guides/authoring/writing-case-specifications/)
is the editorial rulebook for what goes into the seeded specs and the prompt.
Read both before you start. The
`carom` case (`test-cases/end-to-end/easy/carom/v1.0.0/`) is the worked example a new case should
resemble.

## Validate

```sh
tcab prompt  --test-case <slug> --version <version> --variant <variant>
tcab seed    --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository for every variant to confirm
the manifest resolves and the seeded set is self-contained.

## Next steps

- [Create an End-to-End Variant](/quickstarts/authoring/create-an-end-to-end-variant/) to
  add another mode.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
