---
title: Authoring an Audio Test Case
---

## Overview

An audio [asset-generation](/testing/asset-generation/overview/#audio) test case
asks a model to author one short game-audio clip to match a written brief: a
sound effect or a snatch of music. There is no target clip. The model is given a
precise description of the sound and builds something that matches it. It cannot
hear its own output, so the binary renders a waveform and spectrogram, and a
piano-roll for music, that it reads to see its progress.

Read [Audio cases](/testing/asset-generation/manifests/audio-cases/) for the
authoritative manifest schema and
[The audio binaries](/testing/asset-generation/audio-binaries/) for how each
tool behaves and which packs and banks ship.

A case is exactly one of three kinds, chosen by `asset_kind`. This is a
version-level choice rather than a variant axis:

- `sfx-synth` synthesizes a sound effect from a modular synth graph alone:
  oscillators, noise, envelopes, filters, FM. It declares no packs. The worked
  example is `spectra-laser`.
- `sfx-sample` layers a sound effect over a sample library, the game-audio-DAW
  tier: select, layer, time, pitch, and process recorded library clips, with
  synth voices for glue. It declares exactly one sample pack. The worked example
  is `thunderhead-broadside`.
- `music` sequences a short piece as notes on instrument tracks over an
  instrument bank, and emits a portable `.mid` beside the `.wav`. It declares
  exactly one instrument bank. The worked example is `thunderhead-theme`.

## Case layout

A version lives under `test-cases/<type>/<difficulty>/<slug>/<version>/` and is
immutable once a run references it. Revise by adding a new version.

```text
test-cases/<type>/<difficulty>/<slug>/<version>/
  test-case.toml         # manifest: type, asset_kind, audio, tool, output, domain
  variants/              # one standalone TOML file per variant, listed in `variants`
  prompt.hbs             # rendered per run into the model's instruction (NOT seeded)
  description.md         # site-facing prose (NOT seeded)
  changelog.md           # required per-version changelog entry (NOT seeded)
  README.md              # human overview (NOT seeded)
  specs/brief.md         # the brief (SEEDED)
```

A run receives the selected variant's specs, the audio binary whose `--help` is
the operations contract, and a seeded config next to the workspace
(`sfx-synth.config.json`, `sfx-sample.config.json`, or `music.config.json`)
carrying the `[audio]` format, the synthesis seed, the declared pack or bank, and
the log, preview, and output paths. No operations schema is seeded.

The packs a case declares are staged into `/opt/audio` when the run container
starts, outside the model's workspace, so the library the model browses with
`list-samples`, or the instruments it names with `define-track`, is present from
the first command. A container carries the declared packs and no others.

Rendering is a separate, on-request step that mixes the recorded operations down
to the `.wav` and draws the preview. The render is deterministic, so replaying
the recorded operations reproduces the same `.wav`, and the recorded operation
log is the authoritative output.

## Procedure

### 1. Choose the kind

Pick `asset_kind` by what skill you want to measure:

- `sfx-synth` measures whether a model can build a sound from oscillators and
  noise alone. Name it when the sound is fundamentally synthetic, such as a
  laser, a UI blip, or a sci-fi pulse.
- `sfx-sample` measures whether a model can select, layer, time, pitch, and
  process library clips the way a game-audio DAW does. It carries every synth
  voice as well, for glue, and it declares one sample pack.
- `music` measures composition: pitches, beats, and durations on instrument
  tracks. It declares one instrument bank and emits a portable `.mid` beside the
  `.wav`.

A declared pack is a `name@version` ref rather than a path in this repo, and the
published packs are listed under
[the sample library](/testing/asset-generation/audio-binaries/#the-sample-library).
`scripts/ci/audio-packs-check.mjs` resolves every declared ref against
`containers/sample-packs/`, so a case names only a pack that has been published
at that version, of the kind its `asset_kind` requires. To publish one, see
[Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/).

Pick a catalog slug for the lineage and a `version` (`vX.Y.Z`).

### 2. Write the brief

Write `specs/brief.md` as a single self-contained file. The reviewer hears the
finished clip against this text, so describe the sound rather than the
operations:

- the sound's character and role: what it is and where a game uses it, in
  concrete sonic terms, such as bright or dark, tight or booming, its pitch
  register, and its grit or cleanliness;
- its envelope and timing within `max_duration_ms`: the shape over time, the
  attack transient, how long the body sustains, the decay and the tail. For
  music, the tempo, meter, and roughly how many bars it runs. State it so the
  whole clip fits inside the cap you set;
- the layers, synth graph, or note material, conceptually. For `sfx-synth`, the
  voices that stack. For `sfx-sample`, the kind of layers to composite from the
  pack, described as ingredients rather than exact sample names, since the model
  must reason over the library itself. For `music`, the instruments, the melodic
  and harmonic idea, and the feel;
- `mono` or `stereo`, and how the image should be placed when stereo matters;
- for `sfx-sample` and `music`, which pack it draws from, so the brief matches
  the manifest, and that the model browses the library by metadata with
  `list-samples` and `sample-info` because it cannot audition audio;
- how the tool behaves: that the binary is the only way to shape sound, that it
  renders only on the `render` command, that the recorded operations are the
  output, and that the model should read the binary's `--help` for the exact
  operation vocabulary.

The brief must stand on its own with no link outside the seeded set, and every
audible detail written in real terms. A shared quality directive is prepended to
every asset-generation prompt at render time, so keep the brief factual.

### 3. Write `prompt.hbs`

A short instruction pointing the model at the seeded brief, telling it to read
the binary's `--help` for the operations and, for a sampled kind, to browse the
library with `list-samples` first, and stating the hard requirements: shape
sound only through the tool, call `render` to preview, keep the clip within
`max_duration_ms`, and return when finished. The template renders in strict
mode, so use only the documented variables: `{{variant.slug}}`,
`{{variant.name}}`, `{{variant.description}}`, `{{time_limit_hours}}`,
`{{workspace}}`, and `{{#each specs}}`.

### 4. Write the manifest

Author `test-case.toml` per
[Audio cases](/testing/asset-generation/manifests/audio-cases/). The `sfx-synth`
worked example, which declares no packs:

```toml
type       = "asset-generation"   # required; omitting it defaults to end-to-end
asset_kind = "sfx-synth"

variants = ["variants/base.toml"]

# Replaces [canvas]/[voxel]. It fixes the rendered clip's output format.
[audio]
sample_rate     = 44100      # output sample rate in Hz
channels        = "mono"     # "mono" | "stereo"
max_duration_ms = 800        # cap on the rendered clip's length
# No `packs`: an sfx-synth case builds its sound from oscillators and noise alone.

[tool]
binary  = "sfx-synth"        # the audio binary for this kind
preview = "waveform.png"     # the waveform + spectrogram written on `render`

[output]
actions = "actions.json"     # the recorded op log; core emits clip.wav

[[spec]]
source = "specs/brief.md"

[[domain]]
id = "overall"
name = "Overall"
description = "How good the produced asset is overall, judged against the brief."
```

An `sfx-sample` case is identical in shape and adds the pack it layers over:

```toml
asset_kind = "sfx-sample"

[audio]
sample_rate     = 44100
channels        = "stereo"
max_duration_ms = 4000
# Exactly one sample pack; `sfx-sample` layers and processes over it.
packs = ["combat-core@0.1.0"]

[tool]
binary  = "sfx-sample"
preview = "waveform.png"
```

A `music` case takes the same key with one instrument bank,
`packs = ["gm-lite@0.1.0"]`, and its preview carries a piano-roll as well.

Points to get right:

- `[audio]` requires `sample_rate`, `channels`, and `max_duration_ms`, all
  positive. `packs` holds exactly one sample pack for `sfx-sample`, exactly one
  instrument bank for `music`, and nothing for `sfx-synth`.
- Core emits the rendered `clip.wav`, and for `music` a portable `clip.mid`, to
  paths it provides. Neither is manifest-declared.
- An audio case declares no `[model]`, no `[[reference]]`, no `[build]`, and no
  `[[check]]`.
- The single `overall` `[[domain]]` is the whole review. The clip is judged as a
  whole against its brief, so the case declares no `[[review_item]]` on itself
  or on a variant. See
  [Judged on one overall rating](/testing/asset-generation/manifests/overview/#judged-on-one-overall-rating).
- A variant varies only the seeded brief through an additive `[[spec]]`: a
  tighter register, a shorter cap, a required technique.

### 5. Write the non-seeded docs

`description.md` (site blurb), `changelog.md` (the required per-version entry),
and `README.md` (human overview). These never reach a run.

## Validate your work

Resolve and seed the case. For every variant:

```sh
tcab prompt --test-case spectra-laser --version v1.0.0 --variant base
tcab seed   --test-case spectra-laser --version v1.0.0 --variant base
```

`prompt` renders the instruction, catching strict-mode template errors and
manifest problems including a missing `[audio]` field, a malformed pack ref, and
a `packs` arity that the `asset_kind` forbids. `seed` writes the seeded
repository to disk so you can read exactly what the model would receive and
confirm it is self-contained.

Resolve the declared refs against the registry with:

```sh
node scripts/ci/audio-packs-check.mjs
```

It checks every declared ref names a published pack, at that version, of the kind
the `asset_kind` requires, with every clip the pack needs recorded in
`objects.lock.json`. It reads the committed manifests and needs no credentials,
and it runs on the commit hook and in CI. Lint the specs with
`npm run lint:specs`, then exercise the case end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/)
  covers curating and publishing a pack your case needs.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case, playing the clip against the brief.
