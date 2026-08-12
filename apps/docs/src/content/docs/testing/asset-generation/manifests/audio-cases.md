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
sample_pack     = "naval-weapons@1"  # sfx-sample ONLY: the baked sample pack (name@version)
                             # instrument_bank = "gm-lite@0.1.0"  # music ONLY

[tool]
binary  = "sfx-sample"       # the audio binary: sfx-synth | sfx-sample | music
preview = "waveform.png"     # where the binary writes the waveform + spectrogram
                             # (a piano-roll as well, for music)

[output]
actions = "actions.json"     # the recorded op record
```

## The audio table

`[audio]` fixes the output format and is required for, and only for, an audio
case.

- `sample_rate` is the output rate in Hz and must be positive.
- `channels` is `mono` or `stereo`.
- `max_duration_ms` caps the rendered clip's length and must be positive. It is
  the only length bound: a sound effect typically declares a few seconds, and a
  music case may declare minutes.
- `sample_pack` is required for a `sfx-sample` case and rejected on any other.
- `instrument_bank` is required for a `music` case and rejected on any other.
- A `sfx-synth` case names neither, because it synthesizes from oscillators
  alone.

`sample_pack` and `instrument_bank` are each a `name@version` identifying a
palette baked into the run-container image, never a path in this repository. The
`music` image bakes every instrument bank, so `instrument_bank` selects which one
a case plays. See
[the sample library](/testing/asset-generation/audio-binaries/#the-sample-library)
for the packs and banks that ship.

Core emits the rendered `clip.wav`, and for a `music` case a portable `clip.mid`
score, to paths it provides. Neither is manifest-declared. Because the asset is a
finished waveform, an audio case produces no rig or system for a runtime to play.
