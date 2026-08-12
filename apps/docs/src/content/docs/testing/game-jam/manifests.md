---
title: Manifests
---

A game jam declares its contents in its own `game-jam.toml` manifest, parsed
through a small dedicated schema holding the handful of fields a theme-only
build has. Parsing rejects any unknown key, so a manifest that reaches for
test-case machinery (`difficulty`, `variants`, `type`, `[[spec]]`, and the rest)
fails with a clear error.

## Where jams live

Game jams live in a sibling top-level directory, laid out by slug and version:

```
game-jams/<slug>/<version>/game-jam.toml
```

A jam is themed rather than tiered, so there is no `<type>/<difficulty>`
grouping. Discovery folds the folder into the same catalog as `test-cases/`, so
a jam's slug shares the one global slug namespace and may not collide with a
test-case slug. The folder location and the `game-jam.toml` filename are what
mark a case as a jam; there is no `type` field.

## Fields

A jam declares only these keys. All paths resolve relative to the version
folder.

| Key | Required | Meaning |
| --- | --- | --- |
| `slug` | ✅ | Stable identity (the definition-store key). Identical on every version of the folder. |
| `name` | ✅ | Human-readable display name. |
| `changelog` | ✅ | Per-version changelog entry (a Markdown file). Not seeded. |
| `prompt` | ✅ | The theme brief (a Handlebars template). See below. |
| `[build]` | ✅ | The fixed build interface: `install` and `build`, both stated, neither empty, no `build.module`. Same as a full-stack case. |
| `tags` | — | Free-form tags for browsing and search. |
| `summary` | — | One- or two-sentence abstract on the jam card. Not seeded. |
| `description` | — | Site-facing prose (a Markdown file). Not seeded. |
| `max_runtime_hours` | — | Wall-clock cap for the session, defaulted when omitted. Also the model's stated time budget. |
| `experimental` | — | Hide the version until a deployment opts in. |
| `workspace` | — | Starter workspace directory seeded into the run root. |
| `init` | — | Command run once after the workspace is seeded, before the harness starts. |
| `packages` | — | The `@test-cabinet/*` runtime libraries the build imports, as on a full-stack case. |
| `[[review_item]]` | — | Graded review categories. See below. |

### No `difficulty`, no `variants`

Two fields a test case carries are absent, and declaring either is a parse
error.

A jam is unclassified: the model decides what to build from the theme, so there
is no tier to bracket it into. The resolved case carries an `unrated`
placeholder internally to keep the shared shape uniform, and jams are excluded
from the tiered test-case catalog.

A jam is one theme, so it has no variants. A differently themed jam is a
different jam. Resolution runs a jam as a single implicit `default` variant,
synthesized for the author.

### The theme brief (`prompt`)

The prompt is Handlebars, rendered per run. It states the theme and, where the
author wants it restated, the playable and enjoyable bar. The standing
[game-jam directive](/testing/game-jam/overview/) is prepended automatically, so
the template covers only what is specific to this jam.

Alongside `{{workspace}}` (the absolute in-container project root), a prompt may
reference `{{time_limit_hours}}`, the run's wall-clock budget in hours derived
from `max_runtime_hours`. State the budget so the model can pace itself, and
tell it to run `date` in the container to read the current time.

## Review categories

A jam is reviewed on graded categories rather than a pass/fail checklist. See
[Evaluation](/testing/game-jam/evaluation/) for the scale and how the points
work. There are two ways to declare them.

Declaring no `[[review_item]]` gets the standard set injected at resolution:
Playability, Fun, Theme, Presentation, Audio, Polish, and Creativity, each of
weight 1. This is the expected path and keeps every jam comparable.

Declaring `[[review_item]]` tables replaces that set with the author's own, to
weight or specialize the categories. The type forces every category to be
graded, each is worth `weight × 10` points, and the same `id`, `title`, and
`text` rules apply as elsewhere. The id `overall` is reserved for the reviewer's
whole-game grade. A jam declares no scoring domains, so a category carries no
`domain`, and a graded category carries no automated `validation` script, since
it has no pass/fail verdict to decide. The `[review] format = 2` categories
grammar is binary, so a jam uses the `[[review_item]]` tables instead.
