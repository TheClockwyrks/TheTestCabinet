---
title: Author an Audio Test Case
---

Scaffold a new [audio](/testing/asset-generation/overview/#audio)
asset-generation test case — a model authors one short game-audio clip (a sound
effect or a snatch of music) through an **audio binary**, one recorded operation
at a time, to match a written brief. A case is exactly one kind, fixed by
`asset_kind`: **`sfx-synth`** (DSP-only synth graph, no library), **`sfx-sample`**
(layer over a baked sample pack), or **`music`** (sequence notes over a baked
instrument bank, emits a `.mid`). This is the short version;
[Authoring an Audio Test Case](/guides/authoring/authoring-an-audio-test-case/)
covers it in full, and [Manifests](/testing/asset-generation/manifests/) is the
authoritative schema.

Drawing a sprite or building a game instead? See
[Author an Asset-Generation Test Case](/quickstarts/authoring/author-an-asset-generation-test-case/)
or [Author an End-to-End Test Case](/quickstarts/authoring/author-an-end-to-end-test-case/).
An `sfx-sample` or `music` case names a `name@version` palette baked into the run
image — if it does not exist yet, publish it first with
[Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
(today's published palettes are `combat-core` and `gm-lite`).

## Layout

A version lives at `test-cases/<slug>/<version>/` and is **immutable** once runs
reference it — revise by adding a new version, not by editing a published one.

```text
test-cases/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, audio, tool, output, domains
  variants/              # one standalone TOML file per variant (listed in `variants`)
  prompt.hbs             # rendered into the harness instruction (NOT seeded)
  specs/brief.md         # what to build + how the tool behaves — SEEDED
```

There is **no target clip** and **no `reference/` directory** — an audio case
declares no references and is reviewed by a human (by ear) against its brief.

## Steps

1. Pick the `asset_kind` by the skill you want to measure, plus a catalog **slug**
   and `version`. Worked examples: `spectra-laser` (`sfx-synth`),
   `thunderhead-broadside` (`sfx-sample`, over `combat-core`), `thunderhead-theme`
   (`music`, over `gm-lite`) — read the one matching your kind.
2. Write `specs/brief.md`: describe the **sound**, not the operations — its
   character and in-game role, its envelope and timing within `max_duration_ms`,
   its layers/synth graph/note material conceptually, and `mono`/`stereo`. State
   that the binary shapes sound, renders only on `render`, records the
   authoritative op log, and that its `--help` is the operation vocabulary. Keep it
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications).
   There is **no operations schema**.
3. Write `prompt.hbs` using only the documented template variables
   (`{{variant.*}}`, `{{#each specs}}`) — it renders in strict mode — pointing the
   model at the brief and the binary's `--help` (and, for a sampled kind, to browse
   the library with `list-samples` first).
4. Write `test-case.toml`: metadata (`name`, `difficulty`, `tags`),
   `type = "asset-generation"`, `asset_kind`, a `variants` list of paths to
   standalone variant files (a root key, so it must precede the first table header;
   first = default), and the tables below.
   - **`[audio]`** — `sample_rate`, `channels`, `max_duration_ms` (all required).
     An `sfx-sample` case adds `sample_pack = "name@version"`; a `music` case adds
     `instrument_bank = "name@version"`; `sfx-synth` names neither. An unpinned
     palette is a build error, not a fallback.
   - **`[tool]`** — `binary` (matching the kind) and the `preview` path (waveform +
     spectrogram; a piano-roll too, for `music`). No operations schema.
   - **`[output]`** — the `actions` op log (authoritative). `clip.wav` (and `.mid`
     for `music`) is emitted automatically — not manifest-declared.
   - **`[[domain]]`** / **`[[review_item]]`** the reviewer scores under; a review
     item carries **no `reference`**.
   - **No `[model]`**, **no `[[reference]]`**, **no `[build]`**, **no `[[check]]`** —
     each is rejected.

[Authoring an Audio Test Case](/guides/authoring/authoring-an-audio-test-case/)
is the full procedure — read it, and the matching worked example, before you
start.

## Validate

There is no separate authoring linter — validate by resolving and seeding. For
**every** variant:

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template errors and manifest problems (a missing
`[audio]` field, a `sample_pack` on a non-`sfx-sample` case, an `instrument_bank`
on a non-`music` case, a stray `[[reference]]`/`[build]`/`[[check]]`); `seed`
writes the seeded set (brief + the seeded audio config) so you can confirm it is
self-contained. If you named a `sample_pack`/`instrument_bank`, double-check it is
a published, pinned `name@version`.

## Next steps

- [Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/) —
  if your `sfx-sample` / `music` case needs a pack or bank that does not exist yet.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) to exercise it end to end.
- [Review a Run](/quickstarts/development/review-a-run/) to assess the result against the brief.
