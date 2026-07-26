---
title: Manifests
---

A game jam is **not** a test case, so it does not use the shared `test-case.toml`
format. It declares its contents in its **own** `game-jam.toml` manifest, parsed
through a dedicated, deliberately small schema — only the handful of fields a
theme-only build actually has. Any key that belongs to the test-case manifest but
not to a jam (`difficulty`, `variants`, `type`, `[[spec]]`, …) is **rejected at
parse**, so a jam can never accidentally carry test-case machinery.

## Where jams live

Game jams live in a sibling top-level directory, laid out simply by slug and
version:

```
game-jams/<slug>/<version>/game-jam.toml
```

There is no `<type>/<difficulty>` grouping — a jam is themed, not tiered. Discovery
folds this folder into the same catalog as `test-cases/`, so a jam's slug shares the
one global slug namespace (it may not collide with any test-case slug). The
`game-jam.toml` filename — and the folder location — are what mark a case as a jam;
there is **no `type` field** to declare.

## Fields

A jam declares only these keys. All paths resolve relative to the version folder.

| Key | Required | Meaning |
| --- | --- | --- |
| `slug` | ✅ | Stable identity (the definition-store key). Identical on every version of the folder. |
| `name` | ✅ | Human-readable display name. |
| `changelog` | ✅ | Per-version changelog entry (a Markdown file). Not seeded. |
| `prompt` | ✅ | The **theme brief** (a Handlebars template). See below. |
| `[build]` | ✅ | The fixed build interface — `install` and `build`, both stated, neither empty, no `build.module`. Same as a full-stack case. |
| `tags` | — | Free-form tags for browsing/search. A jam is not tiered, so tags describe only the theme. |
| `summary` | — | One- or two-sentence abstract on the jam card. Not seeded. |
| `description` | — | Site-facing prose (a Markdown file). Not seeded. |
| `max_runtime_hours` | — | Wall-clock cap for the session (defaults when omitted). Also the model's stated **time budget** — see below. |
| `experimental` | — | Hide the version until a deployment opts in. |
| `workspace` | — | Starter workspace directory seeded into the run root. |
| `init` | — | Command run once after the workspace is seeded, before the harness starts. |
| `packages` | — | The `@test-cabinet/*` runtime libraries the build imports (as on a full-stack case). |
| `[[review_item]]` | — | Optional graded review categories (see below). |

### No `difficulty`, no `variants`

Two fields a test case carries are **deliberately absent**, and declaring either is
a parse error:

- **No `difficulty`.** A jam is inherently unclassified — the model decides what to
  build from the theme, so there is no tier to bracket it into. (Internally the
  resolved case carries an `unrated` placeholder purely to keep the shared shape
  uniform; it is never surfaced, and jams are excluded from the tiered test-case
  catalog.)
- **No `variants`.** A jam is one theme. A differently themed jam is a different jam,
  not a variant of this one. Resolution runs a jam as a single implicit `default`
  variant, synthesized for you — you never author a variant file.

### The theme brief (`prompt`)

The prompt is Handlebars, rendered per run. It should state the theme and (optionally)
restate the playable/enjoyable bar; it must **not** restate the standing
[game-jam directive](/testing/game-jam/overview/#the-standing-game-jam-directive),
which is auto-prepended.

Alongside `{{workspace}}` (the absolute in-container project root), a prompt may
reference **`{{time_limit_hours}}`** — the run's wall-clock budget in hours, derived
from `max_runtime_hours`. State the budget so the model can pace itself, and tell it
to run `date` in the container to read the current time and see how much of the
budget remains. The container has `date` (coreutils) for exactly this.

## The run image (Rust + wasm + `date`)

A jam runs in its **own** image,
[`test-cabinet-game-jam`](/testing/game-jam/overview/#the-game-jam-run-image) — not
the full-stack image. It is the full-stack-2d image (the six asset-generation
binaries on `PATH`, plus the base-wasm **Rust → WebAssembly toolchain**) given its
own identity, so a deployment can pin the jam image independently. A model may
therefore write its game's core in Rust and ship it as a **committed** `.wasm` build
input (the compiled wasm is a build input, not a build step — `npm run build` must
not invoke `cargo`/`wasm-pack`), or use plain JS/TS. `date` is present so the model
can check its time budget.

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
  by a category. A jam has no scoring domains, so a category declares no `domain`.
