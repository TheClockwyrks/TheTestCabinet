---
title: Manifests
---

A game jam declares its contents in a `test-case.toml` manifest, like every other
type, but it lives in its **own top-level folder** and declares a much smaller
surface than a spec-driven case. This page documents the differences; read
[Full Stack → Manifests](/testing/full-stack/manifests/) and
[End to End → Manifests](/testing/end-to-end/manifests/) for the shared fields.

## Where jams live

Game jams are **not** under `test-cases/`. They live in a sibling top-level
directory laid out simply by slug and version:

```
game-jams/<slug>/<version>/test-case.toml
```

There is no `<type>/<difficulty>` grouping — a jam is themed, not tiered.
Discovery folds this folder into the same catalog as `test-cases/`, so a jam's slug
shares the one global slug namespace (it may not collide with any test-case slug).

## `type = "game-jam"`

The one field that selects the type. It schedules the run onto the
[`test-cabinet-full-stack-2d`](/testing/full-stack/overview/#the-full-stack-2d-run-image)
image (the six asset-generation binaries on `PATH`) and prepends the standing
[game-jam directive](/testing/game-jam/overview/#the-standing-game-jam-directive) to
the prompt.

```toml
type = "game-jam"
```

## Shared fields

A jam declares the same identity and build fields a full-stack case does, and they
mean the same thing:

- `slug`, `name`, `difficulty`, `tags`, `summary`, `description`, `changelog`,
  `experimental` — identity and site metadata. (`difficulty` is required but a jam
  is not tiered; a neutral value such as `"medium"` is fine.)
- `prompt` — the **theme brief**. Handlebars, rendered per run. It should state the
  theme and (optionally) restate the playable/enjoyable bar; it must **not** restate
  the standing directive, which is auto-prepended.
- `max_runtime_hours`, `workspace`, `init` — as full-stack.
- The **required** `[build]` table — the same fixed build interface (`install` and
  `build`, both stated, neither empty, no `build.module`).
- `packages` — allowed, exactly as on a full-stack case (for example to play a
  produced particle `system.json` through `@test-cabinet/particle-runtime`).
- `variants` — at least one. A jam variant is a **bare theme selector**: it carries
  only its identity. Additional variants could offer sub-themes of the same jam.

## Forbidden tables

Because a jam seeds no specification and grades on categories rather than a rubric,
these tables are **rejected at resolution** — on the case and on every variant:

- **`[[spec]]`** — a jam seeds no specification.
- **`[[reference]]`** and a variant's `reference_implementation` — a jam has no
  reference mockups and no "Reference" tab.
- **`[[domain]]`** — a jam has no scoring domains; its categories are graded
  directly and it carries a single overall grade.
- Every asset-generation-only table (`[canvas]`, `[tool]`, `[output]`, `[sheet]`,
  `[voxel]`, `[model]`, `[ui]`, `[material]`, `[particle]`, `[audio]`,
  `asset_kind`) and the wasm-artifact tables (`[contract]`, `[sandbox]`,
  `[simulation]`, `[match]`, `[replay]`), exactly as on a full-stack case.

## Review categories

A jam is reviewed on **graded categories** rather than a pass/fail checklist (see
[Evaluation](/testing/game-jam/evaluation/)). Two ways to declare them:

- **The generic checklist (default).** Declare **no** `[[review_item]]` and core
  injects the standard set — Playability, Fun, Theme, Presentation, Audio, Polish,
  Creativity — each graded on the five-level scale. This is the expected path and
  keeps every jam comparable.
- **Authored categories.** Declare your own `[[review_item]]`s to weight or
  specialize the categories. Each is graded (the type forces it), worth `weight ×
  10` points, and the same `id`/`title`/`text` rules apply as elsewhere. The id
  **`overall`** is reserved for the reviewer's whole-game grade and may not be used
  by a category.
