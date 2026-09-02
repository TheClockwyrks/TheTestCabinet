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
  oscillators, noise, envelopes, filters, FM. It names neither a sample pack nor
  an instrument bank. The worked example is `spectra-laser`.
- `sfx-sample` layers a sound effect over a baked sample library, the
  game-audio-DAW tier: select, layer, time, pitch, and process recorded library
  clips, with synth voices for glue. It names a `sample_pack`. The worked
  example is `thunderhead-broadside`.
- `music` sequences a short piece as notes on instrument tracks over a baked
  instrument bank, and emits a portable `.mid` beside the `.wav`. It names an
  `instrument_bank`. The worked example is `thunderhead-theme`.

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
carrying the `[audio]` format, the synthesis seed, the baked pack or bank, and
the log, preview, and output paths. No operations schema is seeded.

An `sfx-sample` or `music` run is scheduled onto the image carrying the named
pack or bank, so the library the model browses with `list-samples`, or the
instruments it names with `define-track`, is already present.

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
  voice as well, for glue, and it must name a `sample_pack`.
- `music` measures composition: pitches, beats, and durations on instrument
  tracks. It must name an `instrument_bank` and emits a portable `.mid` beside
  the `.wav`.

A named pack or bank is a `name@version` baked into the run-container image
rather than a path in this repo. A run container is offline, so the palette is
baked in at image-build time and the manifest names which baked palette it
expects. The published palettes are listed under
[the sample library](/testing/asset-generation/audio-binaries/#the-sample-library).
A `sample_pack` or `instrument_bank` value that is not pinned is a build error,
so a case can name only a palette that has been published. To add one, see
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
- for `sfx-sample` and `music`, which pack or bank it draws from, so the brief
  matches the manifest, and that the model browses the library by metadata with
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
worked example, which names no palette:

```toml
type       = "asset-generation"   # required; omitting it defaults to end-to-end
asset_kind = "sfx-synth"

variants = ["variants/base.toml"]

# Replaces [canvas]/[voxel]. It fixes the rendered clip's output format.
[audio]
sample_rate     = 44100      # output sample rate in Hz
channels        = "mono"     # "mono" | "stereo"
max_duration_ms = 800        # cap on the rendered clip's length

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
sample_pack     = "combat-core@0.1.0"   # sfx-sample only

[tool]
binary  = "sfx-sample"
preview = "waveform.png"
```

A `music` case names `instrument_bank = "gm-lite@0.1.0"` in place of
`sample_pack`, and its preview carries a piano-roll as well.

Points to get right:

- `[audio]` requires `sample_rate`, `channels`, and `max_duration_ms`, all
  positive. `sample_pack` is required for `sfx-sample` and rejected elsewhere;
  `instrument_bank` is required for `music` and rejected elsewhere.
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
manifest problems including a missing `[audio]` field, a `sample_pack` on a
non-`sfx-sample` case, and an `instrument_bank` on a non-`music` case. `seed`
writes the seeded repository to disk so you can read exactly what the model
would receive and confirm it is self-contained. Confirm any named palette's
`name@version` against the `name` and `version` in
`containers/sample-packs/<pack>.toml`, and that every object the pack needs is
published with `node scripts/build-sample-pack.mjs <pack> --check`, which reads
the committed manifests and needs no credentials. Lint the specs with
`npm run lint:specs`, then exercise the case end to end with
[Run a Test Case](/quickstarts/development/run-a-test-case/).

## Next steps

- [Publishing an Audio Sample Pack](/guides/authoring/publishing-an-audio-sample-pack/)
  covers curating, publishing, and pinning a pack or bank your case needs.
- [Reviewing Test Run Results](/guides/development/reviewing-test-run-results/)
  assesses a run of your case, playing the clip against the brief.
