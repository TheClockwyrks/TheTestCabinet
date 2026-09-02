---
title: Author an Audio Test Case
---

## Overview

Scaffold an audio asset-generation case: the model authors one short game-audio
clip through an audio binary, one recorded operation at a time, to match a
written brief. A case is exactly one kind, fixed by `asset_kind`: `sfx-synth`
builds a DSP-only synth graph, `sfx-sample` layers over a baked sample pack, and
`music` sequences notes over a baked instrument bank and emits a `.mid` score
alongside the clip. [Audio cases](/testing/asset-generation/manifests/audio-cases/)
is the authoritative manifest schema, and
[Authoring an Audio Test Case](/guides/authoring/authoring-an-audio-test-case/)
is the full procedure.

An `sfx-sample` or `music` case names a `name@version` palette baked into its run
image. A pack declares its version in `containers/sample-packs/<pack>.toml`;
[Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
adds a new one.

## Layout

A version lives at `test-cases/<type>/<difficulty>/<slug>/<version>/` and is
frozen once a run references it. Revise by adding a new version.

```text
test-cases/asset-generation/<difficulty>/<slug>/<version>/
  test-case.toml    # type, asset_kind, [audio], [tool], [output], the overall domain
  variants/         # one standalone TOML file per variant, listed in `variants`
  prompt.hbs        # rendered into the harness instruction; not seeded
  specs/brief.md    # the sound and how the binary behaves; seeded
  description.md    # site-facing summary; not seeded
  changelog.md      # what changed in this version; not seeded
```

A run receives the seeded brief plus the orchestrator-written
`sfx-synth.config.json`, `sfx-sample.config.json`, or `music.config.json`. The
case declares no `[[reference]]`, `[build]`, `[[check]]`, or `[[review_item]]`.

## Steps

1. Pick the `asset_kind` by the skill you want to measure, plus a catalog `slug`
   and a `version`. The worked examples are `spectra-laser` (`sfx-synth`),
   `thunderhead-broadside` (`sfx-sample`) and `thunderhead-theme` (`music`).
2. Write `specs/brief.md`. Describe the sound rather than the operations: its
   character and in-game role, its envelope and timing within
   `max_duration_ms`, its layers, synth graph or note material as intent, and
   whether it is mono or stereo. State that the binary shapes sound, renders
   only on `render`, and records the authoritative operation log, and that its
   `--help` is the operation vocabulary. Keep the brief
   [self-contained](/testing/end-to-end/overview/#self-contained-specifications).
3. Write `prompt.hbs` from the documented template variables (`{{workspace}}`,
   `{{variant.*}}`, `{{#each specs}}`). Rendering is strict, so an unknown
   variable is an error. Point the model at the brief and the binary's `--help`.
   For a sampled kind, tell it to browse the library with `list-samples` first.
4. Write `test-case.toml`:
   - the site-facing metadata (`name`, `difficulty`, `tags`, `summary`,
     `description`, `changelog`), `prompt`, `max_runtime_hours`, and
     `type = "asset-generation"`;
   - `asset_kind`, and `variants`, a list of paths to the files under
     `variants/`. It is a root key, so it precedes the first table header, and
     its first entry is the default;
   - `[audio]` with `sample_rate`, `channels` (`mono` or `stereo`) and
     `max_duration_ms`. An `sfx-sample` case adds `sample_pack = "name@version"`
     and a `music` case adds `instrument_bank = "name@version"`; `sfx-synth`
     names neither;
   - `[tool]` naming the `binary` for the kind and the `preview` PNG path, and
     `[output]` naming the `actions` log. Core emits `clip.wav`, and `clip.mid`
     for `music`, automatically;
   - one `[[domain]]` with `id = "overall"`, the single rating the clip is
     judged on.
5. Write each variant file under `variants/`, giving it a `slug`, a `name`, a
   `description`, and any additive `spec` entries.

## Validate

Run both commands for every variant.

```sh
tcab prompt --test-case <slug> --version <version> --variant <variant>
tcab seed   --test-case <slug> --version <version> --variant <variant>
```

`prompt` catches strict-mode template errors and manifest errors, including a
missing `[audio]` field, a `sample_pack` on a kind other than `sfx-sample`, and
an `instrument_bank` on a kind other than `music`. `seed` writes the seeded
repository under `tmp/`, so you can confirm the seeded set is self-contained.

## Next steps

- [Publish an Audio Sample Pack](/quickstarts/authoring/publish-an-audio-sample-pack/)
  builds and pins a pack or bank the case needs.
- [Run a Test Case](/quickstarts/development/run-a-test-case/) exercises the
  case end to end.
- [Review a Run](/quickstarts/development/review-a-run/) rates the clip against
  the brief.
