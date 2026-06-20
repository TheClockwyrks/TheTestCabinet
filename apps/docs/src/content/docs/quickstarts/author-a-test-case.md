---
title: Author a Test Case
---

Scaffold a new test case (or a new version of an existing one). This is the
short version; [Authoring a Test Case](/guides/authoring-a-test-case/) covers
spec-writing and the rules in full, and
[Test Cases](/testing/end-to-end/overview/) is the authoritative schema.

## Layout

A version lives at `test-cases/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml     # manifest: specs, variants, references, checks
  prompt.hbs         # rendered into the harness instruction (NOT seeded)
  specs/             # the specification, decomposed by concern — SEEDED
  reference/         # mockup source, rendered to screenshots — NOT seeded
  assets/            # sprites etc. the model must use — SEEDED (omit if none)
```

## Steps

1. Pick a catalog **slug** (e.g. `pong`) and a separate original **in-game
   title** (e.g. `Carom`). The case must be inspired by but **not a clone** of
   its source, and must need no API keys and no backend to play.
2. In the overview spec, fix the **coordinate system**, **palette/type**, and
   **screens** every other spec leans on.
3. Decompose the spec into focused, seeded files that cross-reference each other
   **by name** (overview, playfield, physics, flow, plus mode specs). Keep them
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications):
   no links outside the seeded set, no dependence on the reference source.
4. Write `prompt.hbs` using only the documented template variables
   (`{{workspace}}`, `{{variant.*}}`, `{{#each specs}}`) — it renders in strict
   mode.
5. Author each reference view as self-contained HTML sharing a `theme.css`; the
   harness renders these to screenshots. Never seed the source.
6. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`), the required
   `[build]` commands, the common `[[spec]]`/`[[reference]]` lists, at least one
   `[[variant]]`, and any opt-in `[[check]]`.

The `authoring-a-test-case` skill is the practical procedure to follow while
doing this; read it before you start. The `pong` case
(`test-cases/pong/v1.0.0/`) is the worked example a new case should resemble.

## Validate

```sh
tcab prompt  --test-case <slug> --version <version> --variant <variant>
tcab seed    --test-case <slug> --version <version> --variant <variant>
```

Render the prompt and inspect the seeded repository for every variant to confirm
the manifest resolves and the seeded set is self-contained.

## Next steps

- [Create a Variant](/quickstarts/create-a-variant/) to add another mode.
- [Run a Test Case](/quickstarts/run-a-test-case/) to exercise it end to end.
