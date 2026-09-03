---
title: Audio cases
---

An audio case, `asset_kind = "sfx-synth"`, `"sfx-sample"`, or `"music"`, produces
a short [clip](/testing/asset-generation/overview/#audio) rendered to a PCM
`.wav` with the [audio binaries](/testing/asset-generation/audio-binaries/). It
declares an `[audio]` table in place of `[canvas]` or `[voxel]`, and declares no
`[model]`. A case authors one clip.

Everything on the
[Manifests overview](/testing/asset-generation/manifests/overview/) applies
unchanged.

```toml
# A sample-library sound effect (asset_kind = "sfx-sample").
asset_kind = "sfx-sample"

[audio]
sample_rate     = 44100      # output sample rate in Hz (required, > 0)
channels        = "stereo"   # "mono" | "stereo" (required)
max_duration_ms = 5000       # cap on the rendered clip's length in ms (required, > 0)
packs           = ["combat-core@0.1.0"]  # the one pack this case plays

[tool]
binary  = "sfx-sample"       # the audio binary: sfx-synth | sfx-sample | music
preview = "waveform.png"     # where the binary writes the waveform + spectrogram
                             # (a piano-roll as well, for music)

[output]
actions = "actions.json"     # the recorded op record
```

## The audio table

`[audio]` fixes the output format and names the case's audio palette. It is
required for an audio case and rejected on every other asset kind. An unknown key
in the table is an error.

- `sample_rate` is the output rate in Hz and must be positive.
- `channels` is `mono` or `stereo`.
- `max_duration_ms` caps the rendered clip's length and must be positive. It is
  the only length bound: a sound effect typically declares a few seconds, and a
  music case may declare minutes.
- `packs` lists the audio packs the run may reach. The three format fields are
  required on every audio case; `packs` is required for `sfx-sample` and `music`.

## Packs

`packs` is the authoritative statement of every pack a run may reach, and it is
the only place a case names one. Each entry is a `name@version` ref, never a path
in this repository. Both halves are required, so a run's palette is pinned to one
published version and its identity is checkable when the tool loads it. Naming a
pack twice is an error: a run carries one version of a pack.

The run container carries the declared pack's clips and nothing else, so `packs`
is also the boundary of what `list-samples` and `list-instruments` can browse.
A pack is committed under `containers/sample-packs/` as a collection of clip ids,
and its audio is assembled from the clip store. See
[the sample library](/testing/asset-generation/audio-binaries/#the-sample-library)
for how a palette is defined and which packs and banks ship.

How many packs a case declares, and of which kind, follows from its
`asset_kind`:

| `asset_kind` | `packs` |
| --- | --- |
| `sfx-sample` | exactly one, a sample pack |
| `music` | exactly one, an instrument bank |
| `sfx-synth` | absent, or empty |

A `sfx-synth` case declares no pack because it synthesizes from oscillators
alone. Declaring a different count, or a pack whose kind is the other one, is an
error naming the case's kind and the pack's.

`scripts/ci/audio-packs-check.mjs` resolves every declared ref against
`containers/sample-packs/`, so a case that names an unknown pack, pins a version
the pack manifest does not carry, declares a pack of the wrong kind, or reaches a
clip that has not been published fails the commit hook and CI rather than the
run.

Core emits the rendered `clip.wav`, and for a `music` case a portable `clip.mid`
score, to paths it provides. Neither is manifest-declared. Because the asset is a
finished waveform, an audio case produces no rig or system for a runtime to play.
