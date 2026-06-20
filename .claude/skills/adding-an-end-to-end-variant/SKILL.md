---
description: Read this skill before adding a new variant (a playable mode/configuration) to an existing END-TO-END test case, registered in a version's test-case.toml. For a variant of an asset-generation case (a brief variation against the shared target) use adding-an-asset-generation-variant instead.
name: adding-an-end-to-end-variant
---

# Adding an End-to-End Variant

## What a variant is

An end-to-end test case version (`test-cases/<slug>/<version>/`) offers one or
more **variants**, and a run selects exactly one. Every variant seeds the
version's **common specs** plus its own **additive** specs, so a single case can
describe several builds — for example the same game with or without an extra mode
— without duplicating the shared specification. The chosen variant's slug is
recorded in the run record.

This skill covers variants of **end-to-end** cases. For a variant of an
[asset-generation](../../../apps/docs/src/content/docs/testing/asset-generation/overview.md)
case — which varies the drawing brief against a single shared target rather than
adding a game mode — use the
[`adding-an-asset-generation-variant`](../adding-an-asset-generation-variant/SKILL.md)
skill instead.

The authoritative schema for variants lives in
[`testing/end-to-end/overview.md`](../../../apps/docs/src/content/docs/testing/end-to-end/overview.md) (see its *Variants* and
*Self-Contained Specifications* sections). Read it before starting; this skill is
the practical procedure that sits on top of it.

The worked example throughout is the **Gyre** variant of the `pong` case
(`test-cases/pong/v1.0.0/`), in which the obstacles oscillate and rotate. Read
the existing `frenzy`, `multi`, and `gyre` mode specs alongside this skill — a
new variant should look like them.

## Anatomy of a test case version

```text
test-cases/pong/v1.0.0/
  test-case.toml         # manifest: specs, variants, references, proofs, checks, review items
  prompt.hbs             # rendered per run into the model's instruction
  description.md         # site-facing prose (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/
    overview.hbs         # common specs, seeded for EVERY variant
    playfield.md
    physics.md
    flow.md
    modes/
      standard.md        # common (always seeded)
      frenzy.md          # variant-only spec
      multi.md           # variant-only spec
      gyre.md            # variant-only spec
  reference/             # mockup SOURCE — rendered to screenshots, NOT seeded
    theme.css
    menu-<variant>.html  # per-variant `title` mockup
    gameplay.html        # common reference view
    game-over.html       # common reference view
    screenshots/         # git-ignored; the harness renders these
```

A variant typically adds **one** mode spec and **one** `title` mockup, and
registers itself in `test-case.toml`. Everything else is shared.

## Procedure

### 1. Choose the variant

Decide four things and keep them consistent everywhere:

- **slug** — lowercase, used in `test-case.toml` and the mode spec filename
  (e.g. `gyre`).
- **display name** — title case, the variant's `name` in the manifest
  (e.g. `Gyre`).
- **menu label** — the upper-case entry shown in the main menu (e.g. `GYRE`),
  placed among the existing entries.
- **HUD / in-game label** — usually the same upper-case token.

Favor a single evocative word that matches the case's existing mode names.

### 2. Write the mode spec

Create `specs/modes/<slug>.md`. Follow the shape of the sibling mode specs:

- Open by stating which common specs it builds on, by name.
- A **Menu entry** section saying which label it adds and where it sits.
- A **Mode** section describing the rules, framed as a delta against an existing
  mode ("same as Solo, except …").
- Whatever mechanic sections the variant needs, with **precise, testable
  numbers** (pixels, degrees, seconds, multipliers) in the same coordinate system
  and style as the common specs. Vague prose is the most common failure here.
- The exact HUD label.

A variant spec **may** reference the common specs freely (they are always
seeded). It must **not** reference another variant's spec.

### 3. If you contradict a common spec, soften the common spec

Common specs are seeded for *every* variant, so a variant cannot simply ignore a
flat statement in one — the contradiction would ship to the model. When a new
variant overrides something a common spec asserts absolutely, generalize that
statement to **defer to the active mode spec**, exactly as the speed-cap rule
already does ("modes may override this; see the mode specs").

- Keep the change minimal and **generic**: refer to "a mode spec under
  `specs/modes/`", never to your new variant file by name. Naming a variant-only
  spec from a common spec breaks self-containment for every *other* variant.
- The behavior of existing variants must not change — you are only widening
  wording from "never" to "unless a mode says so".

For Gyre this meant softening the "obstacles do not move" / "axis-aligned" /
"moving obstacles out of scope" statements in `playfield.md`, `physics.md`, and
`flow.md` to point at the mode specs, while `gyre.md` carries the actual moving,
rotating-obstacle rules.

### 4. Add the per-variant `title` mockup

The main menu differs per variant, so the `title` view is variant-specific. Copy
the closest sibling `reference/menu-<other>.html` to `reference/menu-<slug>.html`
and:

- Update the comment block (variant name, the modes it lists, the spec it
  matches).
- Insert the new menu entry in the right position.
- Optionally tweak the dimmed field furniture to hint at the mechanic (Gyre tilts
  its obstacles), but keep `theme.css`, layout, and palette unchanged.

These mockups are **source only**: the harness renders them to screenshots and
seeds the *screenshot*, never the HTML. Do not seed mockup source, and do not
hand-create anything under `reference/screenshots/` — it is git-ignored and
rendered by the harness per variant.

### 5. Register the variant in `test-case.toml`

Add a `[[variant]]` table (after the existing ones; the first variant is the
default). For a variant that adds one mode spec and one title mockup:

```toml
[[variant]]
slug = "gyre"
name = "Gyre"
description = "Standard plus a mode whose obstacles oscillate and rotate."
spec = [{ source = "specs/modes/gyre.md", dest = "specs/modes/gyre.md" }]
reference = [{ view = "title", path = "reference/menu-gyre.html" }]
review_item = [
  { id = "gyre-oriented-bounce", title = "Oriented bounces", text = "In Gyre the obstacles sway and rotate, and the ball bounces off their tilted faces at oriented angles." },
]
```

Rules to respect (enforced at resolution — see `apps/docs/src/content/docs/testing/end-to-end/overview.md`):

- `spec` entries are **additive** on top of the common specs. Within one variant,
  no two seeded specs (common + own) may share a `dest`.
- `reference` entries are additive on top of the common `[[reference]]` views. A
  view slug must not be declared both commonly and by a variant.
- `review_item` entries are additive on top of the common `[[review_item]]`s. Add
  one for the mode this variant introduces — the observable thing a reviewer must
  check that the standard modes don't have (Gyre's oriented bounce, Frenzy's
  uncapped speed ramp). An item `id` must be unique within the variant's effective
  set (common + own). Review items are reporter-side, never seeded. An item may
  pair an expected reference and the submitted proof via its optional `reference`
  (a reference view) and `proof` (a proof id) — each must resolve for this variant
  (a common one or one this variant adds).
- `proof` entries are additive on top of the common `[[proof]]`s — declare one
  only if this variant asks for proof a standard mode doesn't. A proof `id` must
  be unique within the variant's effective set, its `dest` must not collide with a
  seeded file, and (as with common proofs) the seeded mode spec must instruct the
  build to write the file at that same `dest`.
- Any **checked** view (declared under `[[check]]`) must be supplied by *every*
  variant — for `pong`, every variant provides its own `title`, which is what the
  `title` check baselines against.

Also update the human-readable comment in the manifest that enumerates the
variants so the list stays accurate.

### 6. Update the non-seeded docs

These are not seeded into runs, but keep them honest:

- `README.md` — the variant count and the per-variant summary list.
- `reference/README.md` — the `title` mockup table and the sentence describing
  how the menus differ.
- `description.md` — only if the case's site blurb enumerates modes (it usually
  does not).

### 7. Validate

From the repository root:

```sh
npm run lint:specs   # markdownlint-cli2 + cspell over test-cases/**
```

- If `cspell` flags a legitimate domain term, add it to
  [`.cspell/project-words.txt`](../../../.cspell/project-words.txt) — do not
  reword good prose to dodge the dictionary.
- Confirm the manifest parses and the variant resolves: every variant (including
  the new one) must supply each checked view, the new `spec`/`reference` paths
  must exist on disk, and no `dest` collides.

There is no committed catalog dataset to regenerate: a case's published data is
exported to the public snapshot by the backend at ingest, and `tcab catalog` only
rebuilds the model catalog. See
[`apps/docs/src/content/docs/components/core/validation.md`](../../../apps/docs/src/content/docs/components/core/validation.md)
for what the harness checks automatically.

A backend-driven run resolves its definition from the backend's store, which
skips a version it already holds — so after adding the variant, **force a
re-ingest** or the new variant will not appear in a run:

```sh
curl -X POST http://127.0.0.1:8787/ingest \
  -H 'content-type: application/json' \
  -d '{"testCases": ["<slug>"], "force": true}'
```

Force-re-ingest overwrites the stored version in place and is for
**development** only. Adding a variant edits an existing version, so do it only
while that version is unpublished; once a published run references the version
it is immutable and a variant change requires a **new version** instead. See
[`development/running.md`](../../../apps/docs/src/content/docs/development/running.md)
and [`testing/end-to-end/overview.md`](../../../apps/docs/src/content/docs/testing/end-to-end/overview.md).

### 8. Commit

Commit on the repository's default branch with a conventional-commit message
scoped to the case, e.g. `feat(pong): add gyre variant …`. Do not commit
rendered screenshots (they are git-ignored) or `node_modules/`.

## Self-containment: the rule that catches people

A run seeds only the selected variant's specs (common + that variant's own) and
the test case's assets — nothing else. The seeded set must be complete and
internally consistent on its own:

- A **common** spec must never reference a **variant-only** spec.
- A **variant** spec may reference common specs (always present) but not another
  variant's spec.
- No spec may reference the mockup **source**, these docs, or any file not
  seeded. Every measurement, color, and screen layout the model needs must be
  written into the specs themselves; the seeded screenshots only illustrate the
  target.

If you can read the new variant's seeded set top to bottom with no dangling
reference and no contradiction, the variant is well-formed.
