---
title: Audio binaries
description: The procedural-synthesis, sample-mixing, and sequencer authoring interfaces and PCM .wav (+ .mid) output contract for the sfx-synth, sfx-sample, and music audio binaries.
---

An audio asset-generation run authors a clip through an audio binary on its
`PATH`, the only channel for shaping sound. The clips are game audio: sound
effects such as weapons firing, footsteps, engines, impacts, and explosions, and
short music such as stingers, fanfares, and loops. There are three binaries, one
per `asset_kind`, each measuring a different tier of audio-authoring skill.

| Binary | `asset_kind` | What it measures |
| --- | --- | --- |
| `sfx-synth` | `sfx-synth` | procedural synthesis — a modular synth op graph: raw DSP and sound-design reasoning |
| `sfx-sample` | `sfx-sample` | layered mixing over a sample library — selection, layering, timing, and processing: the game-audio-DAW tier |
| `music` | `music` | a symbolic sequencer — notes on instrument tracks, rendered and emitted with a portable score |

`sfx-sample` is a capability superset of `sfx-synth`: it carries the same synth
voices and adds a baked sample library to mix over. The library is what changes
the score. `sfx-synth` measures whether a model can build a sound from
oscillators and noise alone, while `sfx-sample` measures whether it can select,
layer, time, and process library clips, with synth voices for glue, the way a
game-audio DAW does. The hard 3D cases' weapon, naval, and footstep SFX use
`sfx-sample`.

The DSP lives in `crates/audio-core`: the oscillators, noise, envelopes, filters,
and FM; the mixer and offline render engine; the WAV encoder; the waveform,
spectrogram, and piano-roll PNG renderers; and the shared CLI record, preview,
and config plumbing. Each binary has its own crate (`crates/sfx-synth`,
`crates/sfx-sample`, `crates/music`) and is baked into its own run-container
image, the `sfx-sample` and `music` images additionally carrying their [baked
sample pack and instrument bank](#the-sample-library), so a run carries only the
tool it uses.

The emitted asset is a finished PCM `.wav`, and `music` also emits a portable
`.mid` score. The clip is a finished waveform, so a game plays the `.wav`
directly and the review UI plays it in an `<audio>` element. The data is the
sound.

## Recording and on-request rendering

Each authoring operation appends itself to the run's operation log and nothing
more. Mixing every voice, sample, and effect down to a waveform costs far more
than recording a parameter, and a clip takes many operations, so rendering is a
separate, on-request step. The orchestrator seeds a config next to the workspace
(`sfx-synth.config.json`, `sfx-sample.config.json`, or `music.config.json`)
carrying the audio parameters, the synthesis seed, the baked pack or bank, and
the log, preview, and output paths, so neither an operation nor `render` needs
those flags. `init` writes an empty log; a run starts pre-seeded.

The `[audio]` table a case declares fixes the clip's format: `sample_rate`,
`channels` (`mono` or `stereo`), and `max_duration_ms`, the clip-length cap. The
output is PCM `.wav`, binary per the
[data-format principle](/testing/asset-generation/overview/), since bulk numeric
audio is never JSON.

The render is deterministic. Synthesis noise draws from a fixed seed carried in
the config, and sample mixing is a pure function of the placed layers, so
replaying the recorded operations reproduces the same `.wav`. The recorded
operation log is the authoritative output.

`render` mixes the recorded voices, samples, and effects down to the clip and
draws the preview PNG: a waveform panel plus a spectrogram, with `music` adding a
piano-roll. This is how the model sees its progress. It cannot hear its output,
so the preview is the honest substitute. The waveform shows the amplitude
envelope, the attack, sustain, decay, and tail; the spectrogram shows spectral
content over time, so a transient, a pitch sweep, a filter sweep, and a decaying
tail are all visible. For `sfx-sample` the model further reasons over the named
library samples' metadata rather than auditioning raw audio. Review is otherwise
subjective: a human plays the finished clip against the brief.

## `sfx-synth` — procedural synthesis

`sfx-synth` builds a sound from oscillators and noise. It maintains a layered
synth op graph: voices on a timeline, each shaped by an envelope, pitch, and
modulation, routed through per-voice, bus, and master effects. The vocabulary is
the binary's own `--help`, and the brief tells the model to read it:

```
sfx-synth --help                 # every operation
sfx-synth add-voice --help       # one operation's exact flags
```

Every operation is a subcommand with flags. A gunshot, for example:

```
sfx-synth add-voice --name boom --wave sine --freq 120 --gain -3 --start 0 --dur 220
sfx-synth set-envelope --voice boom --attack 1 --decay 60 --sustain 0.2 --release 140
sfx-synth set-pitch --voice boom --slide-to 40 --over 180
sfx-synth add-voice --name crack --wave noise --gain -6 --start 0 --dur 40
sfx-synth add-filter --voice crack --type highpass --cutoff 2000
sfx-synth render
```

The operations:

- `add-voice` places an oscillator or noise voice on the timeline:
  `--name`, `--wave <sine|square|saw|triangle|noise>`, `--freq <hz>`,
  `--gain <db>`, `--pan <-1..1>`, `--start <ms>`, and `--dur <ms>`.
- `set-envelope --voice` shapes a voice's amplitude, either as an ADSR
  (`--attack <ms> --decay <ms> --sustain <0..1> --release <ms>`) or as a named
  preset curve `--env <linear|pluck|swell|punch|gate>`.
- `set-pitch --voice --slide-to <hz> --over <ms>` sweeps a voice's pitch: a
  laser's fall, a boom's drop.
- `add-vibrato` and `add-arpeggio` add periodic pitch modulation to a `--voice`,
  taking `--rate <hz>` and `--depth <semitones>`.
- `add-fm --voice --carrier <ratio> --modulator <ratio> --index <k>` adds
  frequency modulation for metallic and complex timbres.
- `add-filter --type <lowpass|highpass|bandpass> --cutoff <hz>` filters a
  `--voice` or a `--bus`, with an optional `--sweep-to <hz> --over <ms>` and a
  `--resonance`.
- `add-distortion --drive`, `add-bitcrush --bits --rate`, and
  `add-ringmod --freq` waveshape a `--voice` or a `--bus` for grit, digital
  crush, and inharmonic clangor.
- `add-reverb --bus --size --mix`, `add-delay --bus --time --feedback --mix`, and
  `add-compressor --bus --threshold --ratio` process a bus, `master` by default.
- `render` mixes down to the `.wav` and draws the waveform and spectrogram PNG.

Layering multiple voices is how complexity is built. A gunshot is not one sound
but several stacked in time: a low boom body, a transient crack, a mechanical
snap, and a decaying tail. Building a sound by stacking simple voices is the
audio analogue of compositing primitives into a field, where each voice is a
primitive and the mix is the composite.

## `sfx-sample` — layered mixing over a sample library

`sfx-sample` is the game-audio-DAW tier: a layered multitrack mixer over a baked
[sample library](#the-sample-library). It carries every synth voice above, used
for glue and sweeteners, and adds the ability to place recorded library clips as
layers. The library is the model's palette, and because the model cannot audition
audio it browses and reasons over each sample's name, tags, duration, and
description.

- `list-samples [--tag <t>]` and `sample-info --name <n>` browse the baked
  library. Both record nothing.
- `add-sample --name <lib-sample> --t <ms>` places a library clip as a layer on
  the timeline, with optional `--gain <db>`, `--pitch <semitones>`,
  `--trim <in,out>`, `--fade-in <ms>`, `--fade-out <ms>`, and `--reverse`.
- The full `add-voice` vocabulary from `sfx-synth` supplies glue and sweeteners
  between the sampled layers.
- The filters, waveshaping, and reverb, delay, and compressor effects from
  `sfx-synth` apply to a layer or a bus.
- `render` mixes down to the `.wav` and draws the waveform and spectrogram PNG.

A naval main-gun broadside layered from library clips plus a synth sub:

```
sfx-sample list-samples --tag explosion
sfx-sample add-sample --name cannon_body_heavy --t 0 --gain -1
sfx-sample add-sample --name impact_metal_dry --t 120 --gain -8 --fade-out 400
sfx-sample add-voice --name sub --wave sine --freq 45 --gain -4 --start 0 --dur 300
sfx-sample set-envelope --voice sub --attack 1 --decay 120 --sustain 0.1 --release 260
sfx-sample add-reverb --bus master --size 0.8 --mix 0.25
sfx-sample render
```

## `music` — sequencer

`music` is a symbolic sequencer: notes on instrument tracks over a tempo and
meter, rendered to audio and emitted alongside a portable score. It is the
easiest of the three to author, because the model works in the abstract symbolic
layer of pitches, beats, and durations rather than shaping raw DSP or selecting
recorded clips.

- `set-tempo --bpm <n>` and `set-time-signature --num --den` fix the clip's tempo
  and meter.
- `define-track --name <n> --instrument <inst>` declares an instrument voice. The
  instrument is either a synth waveform (`sine`, `square`, `saw`, `triangle`,
  `noise`) or a sample-based instrument named from the baked
  [instrument bank](#the-sample-library). A melodic bank instrument is
  pitch-shifted per note from the note it was recorded at, and a percussion
  instrument plays at its native pitch. A bank name with no baked audio renders
  as a mellow triangle, so a run still produces a clip.
- `add-note --track <n> --pitch <C4|midi-number> --t <beats> --dur <beats>` adds
  a note event, with an optional `--velocity 1..127`.
- `set-track-fx --track <n>` sets per-track processing: `--gain <db>`,
  `--pan <-1..1>`, `--reverb <0..1>`, and `--env <linear|pluck|swell|punch|gate>`.
- `render` mixes down to the `.wav`, draws the waveform, spectrogram, and
  piano-roll preview, and emits the portable `.mid` score alongside the clip.

The `.mid` is the score-as-metadata companion to the `.wav`. The `.wav` is the
ready asset a game plays directly, and the `.mid` lets a game re-synthesize the
piece in-engine with its own instruments.

## Live preview

When a run is watched, driven by a [driver](/components/driver/overview/) or the
[Tauri app](/components/tauri/overview/) rather than a plain `tcab run`, the
model's authoring streams to the viewer in real time. The orchestrator adds a
`live` block to the seeded config carrying a `host.docker.internal:host-gateway`
endpoint and an opaque per-run token. When the model runs `render`, the binary
connects back to the run host and streams a one-line JSON header
(`{ token, frame, operation, operationCount, length, audioLength }`) followed by
the freshly rendered preview PNG's raw bytes and then the clip's current `.wav`
bytes. The audio body lets a watcher play the clip as it is built; a
preview-only viewer ignores it.

Streaming is best-effort: it is absent for an unwatched run, it never fails an
operation, and it is never recorded. The recorded operation log and the emitted
`.wav` remain the run's authoritative output.

## The sample library

`sfx-sample`'s sample library and `music`'s instrument bank are baked into their
run-container image at image-build time, the fixed palette each tool ships with.
A run container is isolated and offline, so nothing is fetched at run time and
the library the model browses with `list-samples` is already present in the
image.

The audio files themselves live outside this repo. What the repo commits is a
pack manifest, `containers/sample-packs/<pack>.toml`, listing for each entry its
stable `name`, `tags`, `description`, `license`, a source `url`, and a `sha256`
content hash. The `license` must be CC0 or otherwise permissive, so that produced
clips are freely usable in test cases and published runs. The shipped palettes
are sourced from [Freesound](https://freesound.org) CC0 clips through its free
token API; `containers/sample-packs/README.md` records the sourcing details.

The library must be a palette of elemental ingredients. An entry is a single
layer, a sub-bass body, a dry metal impact, a debris tail, a mechanical reload
click, an air whoosh, an electric arc, that the model composites into a specific
weapon, vehicle, or explosion by selecting, layering, timing, pitching, and
processing several, with synth voices for glue. That composition is what makes
`sfx-sample` an authoring task rather than a lookup: a library of ready-made
gunshots would let a single `add-sample; render` satisfy the brief. A sample is a
primitive and the finished clip is the composite, the same relationship the
[mesh](/testing/asset-generation/mesh-binaries/) tools have between a CSG
primitive and the sculpted field. For the same reason, the browse metadata states
only what each clip is, its source, timbre, and character. How to combine the
primitives is the reasoning under test.

An instrument bank is named by its instrument (`grand_piano`, `violin`), because
a `music` case measures composition rather than identification. Each melodic
entry records the MIDI note it was recorded at (`root_note`) so the sequencer
pitch-shifts it correctly across a track's notes; percussion entries set
`pitched = false` and play native.

A pack is a separately-versioned, content-addressed artifact stored in a private
object-storage bucket. `scripts/build-sample-pack.mjs` fetches the sources named
in the manifest, verifies each `sha256`, normalizes them for sample rate,
loudness, trim, and format, assembles the pack, and records its pin in
`containers/sample-packs/packs.lock.json`. `scripts/curate-instrument-bank.mjs`
curates the instrument banks. The image build resolves that pin, mints a
short-lived presigned URL, and bakes the verified tarball in, so the baked palette
is immutable and versioned with the image. Updating a library is a new pack
version plus an image rebuild.

A case names which baked pack or bank it expects in its `[audio]` table, a
`sample_pack` or `instrument_bank` of the form `name@version`, never a repo path.
The `music` image bakes every instrument bank as a per-name subdirectory, so the
named `instrument_bank` selects which palette a run plays; an `sfx-sample` run
bakes its one sample pack. Three instrument banks ship: `gm-lite`, a broad
general-MIDI palette; `cinematic`, epic orchestral with sectioned strings, brass,
mixed choir, and orchestral percussion; and `synthwave`, analog synths, pads, FM
bells, and an electronic drum machine. A `music` case picks one to match its
genre. `containers/sample-packs/README.md` covers how a pack or bank is curated,
published, and baked.
